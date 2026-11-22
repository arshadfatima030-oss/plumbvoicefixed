import type {LocationItem, TenantWorkspace} from '../src/types/plumbvoice.ts';
import {toE164} from './telnyx.ts';

/** Minutes since midnight and weekday name in a given IANA timezone. */
function localClock(tz: string, now: Date): {day: string; minutes: number} {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {timeZone: tz, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {day: get('weekday'), minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute'))};
}

export const clockToMinutes = (s: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};

/** Marketing-safe texting window: 8:00-21:00 in the business's timezone (conservative proxy for the recipient's local time). */
export function withinTextingHours(tz: string, now = new Date()): boolean {
  const {minutes} = localClock(tz, now);
  return minutes >= 8 * 60 && minutes < 21 * 60;
}

export type CallTag = 'new lead' | 'emergency' | 'existing customer' | 'spam' | 'booking' | 'callback';

export function tagCall(input: {urgency: string; durationSec: number; callerText: string}): {tags: CallTag[]; nextSteps: string} {
  const t = input.callerText.toLowerCase();
  const tags: CallTag[] = [];
  const spam = (input.durationSec < 5 && !t.trim()) || /extended warranty|press 1|you have been selected|vehicle warranty|garantía extendida/.test(t);
  if (spam) return {tags: ['spam'], nextSteps: 'No action needed; likely spam.'};
  if (input.urgency === 'Emergency') tags.push('emergency');
  if (/(already a customer|existing customer|you (came|were) (out|here)|last (week|month|year)|ya soy cliente|vinieron)/.test(t)) tags.push('existing customer');
  else tags.push('new lead');
  if (/(schedule|appointment|book|come out|available|cita|agendar|programar)/.test(t)) tags.push('booking');
  if (/(call me back|call back|callback|llámeme|llamarme|devuélvame)/.test(t)) tags.push('callback');
  const nextSteps = tags.includes('emergency')
    ? 'Call the customer back immediately and dispatch the on-call technician.'
    : tags.includes('booking')
      ? 'Confirm an appointment window with the customer.'
      : tags.includes('callback')
        ? 'Return the customer’s call today.'
        : 'Review the lead and follow up within one business day.';
  return {tags, nextSteps};
}

const ES_WORDS = ['hola', 'necesito', 'tengo', 'tubería', 'tuberia', 'fuga', 'agua', 'ayuda', 'gracias', 'favor', 'urgente', 'casa', 'luz', 'calentador', 'baño', 'cocina', 'por favor', 'buenos', 'días', 'tardes', 'se rompió', 'inundación', 'huele', 'cita', 'cuánto', 'cuanto', 'quiero', 'puede', 'pueden'];

export function detectLanguage(text: string): 'en' | 'es' {
  const t = text.toLowerCase();
  const hits = ES_WORDS.filter((w) => new RegExp(`(^|[^a-záéíóúñ])${w}([^a-záéíóúñ]|$)`).test(t)).length;
  return hits >= 2 || (/[¿¡ñáéíóú]/.test(t) && hits >= 1) ? 'es' : 'en';
}

/**
 * Picks the location that serves a caller. Uses the ZIP when we have one, otherwise the first 5-digit number in what the
 * caller said that matches a location's ZIP list. Returns null when nothing matches (the main business number is the safe default).
 */
export function routeLocation(ws: TenantWorkspace, zip: string, callerText = ''): LocationItem | null {
  const list = ws.extras?.locations ?? [];
  if (!list.length) return null;
  const direct = zip.trim().slice(0, 5);
  if (/^\d{5}$/.test(direct)) {
    const hit = list.find((l) => l.zips.includes(direct));
    if (hit) return hit;
  }
  for (const m of callerText.matchAll(/\b(\d{5})\b/g)) {
    const hit = list.find((l) => l.zips.includes(m[1]));
    if (hit) return hit;
  }
  return null;
}

/** Owner SMS for emergencies; null unless enabled in settings and a valid owner number exists. */
export function buildEmergencyAlert(ws: TenantWorkspace, from: string, description: string, leadId: string, location?: LocationItem | null): {to: string; text: string} | null {
  if (!ws.settings.notificationPreferences.smsOnEmergency) return null;
  const to = toE164(location?.phone || '') || toE164(ws.settings.emergencyRules.escalateToPhone || '');
  if (!to) return null;
  const app = process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' ? process.env.APP_URL.replace(/\/$/, '') : '';
  return {to, text: `PlumbVoice EMERGENCY${location ? ` [${location.name}]` : ''} from ${from}: ${description.slice(0, 160)}${app ? ` ${app}/app/leads/${leadId}` : ''}`};
}
