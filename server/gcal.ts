import crypto from 'node:crypto';
import type {AppointmentItem, WorkingHoursDay} from '../src/types/plumbvoice.ts';
import {clockToMinutes} from './rules.ts';
import {secretsConfigured} from './secrets.ts';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy';

export const gcalConfigured = () =>
  Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET && process.env.APP_URL && secretsConfigured());

export const redirectUri = () => `${(process.env.APP_URL || '').replace(/\/$/, '')}/api/integrations/google/callback`;

export function buildAuthUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH}?${q.toString()}`;
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
      ...params,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Google token request failed (${r.status})`);
  return j;
}

export async function exchangeCode(code: string): Promise<{refreshToken: string | null}> {
  const j = await tokenRequest({code, grant_type: 'authorization_code', redirect_uri: redirectUri()});
  return {refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : null};
}

export async function accessTokenFrom(refreshToken: string): Promise<string> {
  const j = await tokenRequest({refresh_token: refreshToken, grant_type: 'refresh_token'});
  if (typeof j.access_token !== 'string') throw new Error('No access token returned by Google.');
  return j.access_token;
}

// ----- time helpers (no external tz library) -----
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - utcMs;
}

/** Local wall-clock time in an IANA zone -> UTC Date. */
export function zonedToUtc(dateISO: string, minutes: number, tz: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let res = guess - tzOffsetMs(tz, guess);
  res = guess - tzOffsetMs(tz, res); // second pass handles DST boundaries
  return new Date(res);
}

/** "10:00 AM – 12:00 PM" -> {start: 600, end: 720} (minutes since midnight) */
export function parseWindow(w: string): {start: number; end: number} | null {
  const re = /(\d{1,2}):(\d{2})\s*(AM|PM)/gi;
  const vals: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(w)) && vals.length < 2) {
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === 'PM') h += 12;
    vals.push(h * 60 + Number(m[2]));
  }
  return vals.length === 2 && vals[1] > vals[0] ? {start: vals[0], end: vals[1]} : null;
}

export const WINDOW_FORMAT_ERROR = 'With Google Calendar connected the time window must look like "10:00 AM – 12:00 PM".';

export function fmtWindow(start: number, end: number): string {
  const f = (t: number) => {
    const h = Math.floor(t / 60);
    const mm = String(t % 60).padStart(2, '0');
    return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  return `${f(start)} – ${f(end)}`;
}

const localDateTime = (dateISO: string, minutes: number) =>
  `${dateISO}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;

export async function freeBusy(token: string, calendarId: string, from: Date, to: Date): Promise<{start: Date; end: Date}[]> {
  const r = await fetch(`${API}/freeBusy`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{id: calendarId}]}),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Google freeBusy failed (${r.status})`);
  const j = (await r.json()) as {calendars?: Record<string, {busy?: {start: string; end: string}[]}>};
  return (j.calendars?.[calendarId]?.busy ?? []).map((b) => ({start: new Date(b.start), end: new Date(b.end)}));
}

/** Free windows (2h) for a day inside working hours that do not overlap busy blocks. */
export async function listFreeWindows(
  token: string, calendarId: string, dateISO: string, tz: string, hours: WorkingHoursDay[]
): Promise<string[]> {
  const day = new Intl.DateTimeFormat('en-US', {timeZone: tz, weekday: 'long'}).format(zonedToUtc(dateISO, 12 * 60, tz));
  const h = hours.find((x) => x.day === day);
  if (!h?.enabled) return [];
  const open = clockToMinutes(h.open);
  const close = clockToMinutes(h.close);
  if (open < 0 || close <= open) return [];
  const busy = await freeBusy(token, calendarId, zonedToUtc(dateISO, open, tz), zonedToUtc(dateISO, close, tz));
  const out: string[] = [];
  for (let s = open; s + 120 <= close; s += 120) {
    const a = zonedToUtc(dateISO, s, tz).getTime();
    const b = zonedToUtc(dateISO, s + 120, tz).getTime();
    if (!busy.some((x) => x.start.getTime() < b && x.end.getTime() > a)) out.push(fmtWindow(s, s + 120));
  }
  return out;
}

/** Deterministic Google event id (base32hex-safe) so retries can never create duplicates. */
export const eventIdFor = (apptId: string) => crypto.createHash('sha1').update(`plumbvoice:${apptId}`).digest('hex');

export async function isSlotFree(token: string, calendarId: string, dateISO: string, window: string, tz: string, ignoreEventId?: string): Promise<boolean> {
  const w = parseWindow(window);
  if (!w) throw new Error(WINDOW_FORMAT_ERROR); // an unreadable window must never count as "free"
  const busy = await freeBusy(token, calendarId, zonedToUtc(dateISO, w.start, tz), zonedToUtc(dateISO, w.end, tz));
  void ignoreEventId;
  return busy.length === 0;
}

export async function upsertEvent(token: string, calendarId: string, a: AppointmentItem, tz: string): Promise<string> {
  const w = parseWindow(a.timeWindow);
  if (!w) throw new Error(WINDOW_FORMAT_ERROR); // never guess a time: a wrong calendar event is worse than a failed sync
  const id = eventIdFor(a.id);
  const body = {
    summary: a.title,
    description: `Customer: ${a.customerName}\nPhone: ${a.customerPhone}\nBooked with PlumbVoice AI.`,
    location: a.address,
    start: {dateTime: localDateTime(a.dateISO, w.start), timeZone: tz},
    end: {dateTime: localDateTime(a.dateISO, w.end), timeZone: tz},
  };
  const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
  const cal = encodeURIComponent(calendarId);
  let r = await fetch(`${API}/calendars/${cal}/events`, {method: 'POST', headers, body: JSON.stringify({id, ...body}), signal: AbortSignal.timeout(10000)});
  if (r.status === 409) {
    r = await fetch(`${API}/calendars/${cal}/events/${id}`, {method: 'PATCH', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)});
  }
  if (!r.ok) throw new Error(`Google event save failed (${r.status})`);
  return id;
}

export async function patchEvent(token: string, calendarId: string, a: AppointmentItem, tz: string): Promise<void> {
  if (!a.googleEventId) return;
  await upsertEvent(token, calendarId, a, tz);
}
