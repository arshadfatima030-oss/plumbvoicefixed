import crypto from 'node:crypto';
import {planAllows} from './access.ts';
import type {TenantWorkspace} from '../src/types/plumbvoice.ts';
import {assertPublicHttpUrl, safeRequest} from './netguard.ts';
import {store} from './store.ts';

export const WEBHOOK_EVENTS = ['lead_created', 'call_completed', 'emergency_detected', 'appointment_booked'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookLogItem {
  id: string;
  type: string;
  at: string;
  ok: boolean;
  status: number;
  attempts: number;
  error?: string;
}

// Delivery log lives in shared storage (Postgres table `webhook_logs`), so it survives restarts and is the same on
// every server. It is kept out of the workspace document on purpose so background deliveries never race with
// request saves. Logging is best-effort: a storage hiccup must never break the delivery itself.
export const getWebhookLog = (orgId: string): Promise<WebhookLogItem[]> => store.listWebhookLog(orgId, 50);
async function remember(orgId: string, item: WebhookLogItem) {
  try {
    await store.addWebhookLog(orgId, item);
  } catch (e) {
    console.error('[webhook] could not save delivery log:', e instanceof Error ? e.message : e);
  }
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function deliverWebhook(
  orgId: string,
  url: string,
  secret: string,
  type: string,
  data: unknown,
  eventId?: string
): Promise<WebhookLogItem> {
  // Receivers should de-duplicate on this id. Queued events pass a stable one so a retry carries the same id.
  const id = eventId ?? `evt_${crypto.randomUUID()}`;
  const body = JSON.stringify({id, type, createdAt: new Date().toISOString(), organizationId: orgId, data});
  const item: WebhookLogItem = {id, type, at: new Date().toISOString(), ok: false, status: 0, attempts: 0};
  try {
    await assertPublicHttpUrl(url, {httpsOnly: true});
  } catch (e) {
    item.error = e instanceof Error ? e.message : 'Invalid URL';
    await remember(orgId, item);
    return item;
  }
  const delays = [0, 1000, 5000];
  for (const d of delays) {
    if (d) await sleep(d);
    item.attempts++;
    try {
      const ts = String(Math.floor(Date.now() / 1000));
      const r = await safeRequest(new URL(url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PlumbVoice-Event': type,
          'X-PlumbVoice-Id': id,
          'X-PlumbVoice-Timestamp': ts,
          'X-PlumbVoice-Signature': signPayload(secret, ts, body),
        },
        body,
        timeoutMs: 8000,
        maxBytes: 64_000,
      });
      item.status = r.status;
      if (r.status >= 200 && r.status < 300) {
        item.ok = true;
        item.error = undefined;
        break;
      }
      item.error = `Receiver answered ${r.status}`;
      if (r.status < 500 && r.status !== 429) break; // client errors will not succeed on retry
    } catch (e) {
      item.error = e instanceof Error ? e.message : 'Request failed';
    }
  }
  await remember(orgId, item);
  return item;
}

/** Fire-and-forget; never throws and never blocks the request that triggered it. */
export function emitEvent(ws: TenantWorkspace, type: WebhookEvent, data: unknown): void {
  const cfg = ws.extras?.webhook;
  const secret = ws.secrets?.webhookSecret;
  if (!cfg?.enabled || !cfg.url || !secret || !cfg.events.includes(type)) return;
  if (!planAllows(ws, 'webhooks')) return;
  void deliverWebhook(ws.organizationId, cfg.url, secret, type, data).catch(() => {});
}
