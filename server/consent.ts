/**
 * SMS consent ledger (TCPA).
 *
 * Consent is captured BEFORE any text is sent and stored with a timestamp, a source and the purposes it covers.
 * Every outbound customer SMS route calls `checkSmsConsent` first; a send never creates its own proof of consent.
 *
 * Purposes:
 *   service              quotes, booking links, appointment and missed-call replies about a request the customer made
 *   review_request       asking for a Google review after a job
 *   maintenance_reminder future check-up reminders
 *
 * An STOP keyword (smsOptOut list) always wins over any consent record.
 */
import type {SmsConsentPurpose, SmsConsentRecord, SmsConsentSource, WorkspaceExtras} from '../src/types/plumbvoice.ts';

export const SMS_CONSENT_PURPOSES: readonly SmsConsentPurpose[] = ['service', 'review_request', 'maintenance_reminder'];
export const SMS_CONSENT_SOURCES: readonly SmsConsentSource[] = [
  'booking_page', 'website_chat', 'phone_call', 'inbound_call', 'verbal_staff', 'written_form', 'sms_reply',
];
/** Sources a staff member may attest to by hand. The rest are set by the server only. */
export const STAFF_ATTESTED_SOURCES: readonly SmsConsentSource[] = ['verbal_staff', 'written_form'];

const MAX_RECORDS = 5000;

type WithExtras = {extras?: WorkspaceExtras};

export type ConsentCheck = {ok: true; record: SmsConsentRecord} | {ok: false; reason: 'opted-out' | 'no-consent' | 'revoked' | 'purpose-not-covered'};

export function isPurpose(v: unknown): v is SmsConsentPurpose {
  return typeof v === 'string' && (SMS_CONSENT_PURPOSES as readonly string[]).includes(v);
}

export function checkSmsConsent(ws: WithExtras, phoneE164: string, purpose: SmsConsentPurpose): ConsentCheck {
  if ((ws.extras?.smsOptOut ?? []).includes(phoneE164)) return {ok: false, reason: 'opted-out'};
  const rec = (ws.extras?.smsConsents ?? []).find((r) => r.phone === phoneE164);
  if (!rec) return {ok: false, reason: 'no-consent'};
  if (rec.revokedAtISO) return {ok: false, reason: 'revoked'};
  if (!rec.purposes.includes(purpose)) return {ok: false, reason: 'purpose-not-covered'};
  return {ok: true, record: rec};
}

export function consentErrorMessage(reason: Exclude<ConsentCheck, {ok: true}>['reason']): string {
  switch (reason) {
    case 'opted-out':
      return 'This customer opted out of text messages.';
    case 'revoked':
      return 'This customer withdrew their consent to text messages.';
    case 'purpose-not-covered':
      return 'This customer has not agreed to this kind of text message. Record their consent for it first.';
    default:
      return 'No text-message consent is on file for this customer. Record their consent first.';
  }
}

export interface GrantInput {
  phone: string;
  purposes: SmsConsentPurpose[];
  source: SmsConsentSource;
  /** Short proof: form/checkbox version, staff note, call id. Never message content. */
  evidence?: string;
  capturedBy?: string;
  nowISO: string;
}

/** Adds or extends a consent record. Purposes accumulate; a previous withdrawal is cleared only by a fresh grant. */
export function grantSmsConsent(ws: WithExtras, input: GrantInput): SmsConsentRecord {
  const list = ws.extras?.smsConsents ?? [];
  const purposes = [...new Set(input.purposes.filter(isPurpose))];
  const existing = list.find((r) => r.phone === input.phone);
  let rec: SmsConsentRecord;
  if (existing && !existing.revokedAtISO) {
    existing.purposes = [...new Set([...existing.purposes, ...purposes])];
    existing.history = [...(existing.history ?? []), {atISO: input.nowISO, source: input.source, purposes, evidence: input.evidence?.slice(0, 200), by: input.capturedBy}].slice(-20);
    rec = existing;
  } else {
    rec = {
      phone: input.phone,
      purposes,
      source: input.source,
      capturedAtISO: input.nowISO,
      evidence: input.evidence?.slice(0, 200),
      capturedBy: input.capturedBy,
      history: existing?.history?.slice(-19),
    };
    const rest = list.filter((r) => r.phone !== input.phone);
    rest.push(rec);
    ws.extras = {...(ws.extras ?? {}), smsConsents: rest.slice(-MAX_RECORDS)};
    return rec;
  }
  ws.extras = {...(ws.extras ?? {}), smsConsents: list};
  return rec;
}

/** Marks consent withdrawn (STOP keyword, or staff recording a verbal withdrawal). Keeps the record as an audit trail. */
export function revokeSmsConsent(ws: WithExtras, phone: string, nowISO: string): boolean {
  const rec = (ws.extras?.smsConsents ?? []).find((r) => r.phone === phone);
  if (!rec || rec.revokedAtISO) return false;
  rec.revokedAtISO = nowISO;
  return true;
}

/** The customer texted START again: restore the record they already had. Never creates new consent. */
export function restoreSmsConsent(ws: WithExtras, phone: string): boolean {
  const rec = (ws.extras?.smsConsents ?? []).find((r) => r.phone === phone);
  if (!rec?.revokedAtISO) return false;
  delete rec.revokedAtISO;
  return true;
}
