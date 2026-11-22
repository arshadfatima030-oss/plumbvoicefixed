import crypto from 'node:crypto';

/**
 * Telnyx integration helpers (additive; no existing behaviour depends on this file).
 * Env:
 *   TELNYX_API_KEY            Bearer key (SMS send, conversation/recording fetch)
 *   TELNYX_PUBLIC_KEY         Base64 webhook public key from the Telnyx portal (Ed25519)
 *   TELNYX_SMS_FROM           E.164 sender number for SMS (optional)
 *   TELNYX_MESSAGING_PROFILE_ID  Messaging profile id (optional)
 */

const API = 'https://api.telnyx.com/v2';

export function telnyxConfigured(): boolean {
  return Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_PUBLIC_KEY);
}

export function telnyxSmsConfigured(): boolean {
  return Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_SMS_FROM);
}

// DER prefix for an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Verifies `telnyx-signature-ed25519` over `${timestamp}|${rawBody}` and rejects stale timestamps. */
export function verifyTelnyxWebhook(
  rawBody: Buffer | undefined,
  signatureB64: string | undefined,
  timestamp: string | undefined,
  toleranceSec = 300
): boolean {
  const pub = process.env.TELNYX_PUBLIC_KEY;
  if (!pub || !rawBody || !signatureB64 || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  try {
    const raw = Buffer.from(pub, 'base64');
    if (raw.length !== 32) return false;
    const key = crypto.createPublicKey({key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki'});
    const signed = Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]);
    return crypto.verify(null, signed, key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Defence in depth for the ring-first TeXML URLs (their main protection is the secret in the URL).
 * - A request that carries Telnyx signature headers must verify; a bad signature is always refused.
 * - A request with no signature headers is accepted only while `required` is false (see texmlSignatureRequired:
 *   required by default in production). When required, unsigned requests are refused, and so is everything when
 *   TELNYX_PUBLIC_KEY is missing (fail closed).
 */
/** Secure by default: required in production. TEXML_REQUIRE_SIGNATURE=true/false overrides (false only if Telnyx does not sign TeXML for you). */
export function texmlSignatureRequired(env: Record<string, string | undefined>): boolean {
  const v = env.TEXML_REQUIRE_SIGNATURE?.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return env.NODE_ENV === 'production';
}

export function texmlSignatureOk(rawBody: Buffer | undefined, signatureB64: string | undefined, timestamp: string | undefined, required: boolean): boolean {
  if (signatureB64 || timestamp) return verifyTelnyxWebhook(rawBody, signatureB64, timestamp);
  return !required;
}

export interface TelnyxCallEvent {
  eventId: string;
  eventType: string;
  conversationId: string;
  from: string;
  to: string;
  durationSec: number;
  transcript: {speaker: 'agent' | 'caller'; text: string}[];
  recordingUrl?: string;
  summary?: string;
}

const asStr = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Normalises call.conversation.ended / call.analyzed. Telnyx documents the envelope as {data:{event_type,payload}};
 * fields beyond those documented (transcript, recordings, insights) are read defensively and may be absent.
 */
export function parseTelnyxCallEvent(body: unknown): TelnyxCallEvent | null {
  const root = isObj(body) ? body : {};
  const data = isObj(root.data) ? root.data : root;
  const eventType = asStr(data.event_type, 80);
  const p = isObj(data.payload) ? data.payload : null;
  if (!eventType || !p) return null;
  const conversationId = asStr(p.conversation_id, 100) || asStr(p.call_control_id, 160) || asStr(data.id, 100);
  if (!conversationId) return null;

  const transcript: TelnyxCallEvent['transcript'] = [];
  const msgs = Array.isArray(p.messages) ? p.messages : Array.isArray(p.transcript) ? p.transcript : [];
  for (const m of msgs.slice(0, 200)) {
    if (!isObj(m)) continue;
    const text = asStr(m.text, 1000) || asStr(m.content, 1000);
    if (!text) continue;
    const role = asStr(m.role, 20);
    transcript.push({speaker: role === 'assistant' || role === 'agent' ? 'agent' : 'caller', text});
  }

  let recordingUrl: string | undefined;
  const recs = Array.isArray(p.recordings) ? p.recordings : [];
  for (const r of recs) {
    if (!isObj(r)) continue;
    const u = asStr(r.recording_url, 1000) || asStr(r.url, 1000) || (isObj(r.download_urls) ? asStr(r.download_urls.mp3, 1000) : '');
    if (u.startsWith('https://')) {
      recordingUrl = u;
      break;
    }
  }

  const insights = Array.isArray(p.insights) ? p.insights : [];
  let summary = asStr(p.summary, 600);
  if (!summary) {
    for (const i of insights) {
      if (isObj(i)) {
        const t = asStr(i.result, 600) || asStr(i.summary, 600);
        if (t) {
          summary = t;
          break;
        }
      }
    }
  }

  return {
    eventId: asStr(data.id, 100),
    eventType,
    conversationId,
    from: asStr(p.from, 40),
    to: asStr(p.to, 200),
    durationSec: Math.max(0, Math.min(7200, Math.round(Number(p.duration_sec ?? p.duration) || 0))),
    transcript,
    recordingUrl,
    summary: summary || undefined,
  };
}

/** Best-effort transcript fetch if the webhook did not include messages. Returns [] on any failure. */
export async function fetchConversationTranscript(conversationId: string): Promise<TelnyxCallEvent['transcript']> {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch(`${API}/ai/conversations/${encodeURIComponent(conversationId)}/messages`, {
      headers: {Authorization: `Bearer ${key}`},
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as unknown;
    const arr = isObj(j) && Array.isArray(j.data) ? j.data : [];
    const out: TelnyxCallEvent['transcript'] = [];
    for (const m of arr.slice(0, 200)) {
      if (!isObj(m)) continue;
      const text = asStr(m.text, 1000) || asStr(m.content, 1000);
      const role = asStr(m.role, 20);
      if (text && role !== 'system' && role !== 'tool') out.push({speaker: role === 'assistant' ? 'agent' : 'caller', text});
    }
    return out;
  } catch {
    return [];
  }
}

export async function sendTelnyxSms(to: string, text: string): Promise<{ok: boolean; id?: string; error?: string}> {
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_SMS_FROM;
  if (!key || !from) return {ok: false, error: 'Telnyx SMS is not configured.'};
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return {ok: false, error: 'Destination must be an E.164 number.'};
  try {
    const r = await fetch(`${API}/messages`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        from,
        to,
        text: text.slice(0, 600),
        ...(process.env.TELNYX_MESSAGING_PROFILE_ID ? {messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID} : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json().catch(() => ({}))) as unknown;
    if (!r.ok) return {ok: false, error: `Telnyx returned ${r.status}`};
    const id = isObj(j) && isObj(j.data) ? asStr(j.data.id, 80) : undefined;
    return {ok: true, id};
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : 'SMS request failed'};
  }
}

/** Normalises a US-style number to E.164 (+1XXXXXXXXXX) or returns ''. */
export function toE164(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(d)) return d;
  const digits = d.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}
