import type {ChatTurn} from './agent.ts';
import {isRecord, str} from './validate.ts';

/**
 * Abuse and cost controls for the public website chat. The domain allowlist is only a browser CORS rule and any script
 * can fake an Origin header, so it is NOT a security boundary: these counters and caps are what protect the owner's AI bill.
 * Every number can be tuned with an env var; defaults suit a small trades business.
 */
export interface ChatLimits {
  ipPer10Min: number;
  ipPerDay: number;
  sessionPerHour: number;
  orgPerHour: number;
  orgPerDay: number;
  /** Most recent turns sent to the model (a long history is re-sent, and re-billed, on every request). */
  maxTurns: number;
  /** Total characters of conversation sent to the model. */
  maxChars: number;
}

const int = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function chatLimits(env: Record<string, string | undefined> = process.env): ChatLimits {
  return {
    ipPer10Min: int(env.CHAT_IP_PER_10MIN, 20, 1, 1000),
    ipPerDay: int(env.CHAT_IP_PER_DAY, 80, 1, 10_000),
    sessionPerHour: int(env.CHAT_SESSION_PER_HOUR, 25, 1, 1000),
    orgPerHour: int(env.CHAT_ORG_PER_HOUR, 300, 1, 100_000),
    orgPerDay: int(env.CHAT_ORG_PER_DAY, 1500, 1, 1_000_000),
    maxTurns: int(env.CHAT_MAX_TURNS, 14, 2, 40),
    maxChars: int(env.CHAT_MAX_CHARS, 4000, 200, 24_000),
  };
}

export type Hit = (key: string, windowMs: number) => Promise<{count: number; resetAt: number}>;
export type BudgetResult = {ok: true} | {ok: false; scope: string; retryAfterSec: number};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Counts one chat message against the limits of one phase, most specific first, and STOPS at the first one exceeded.
 *  - 'ip':  per-visitor-address limits. Needs no database read, so it runs before anything else.
 *  - 'org': per-conversation and business-wide limits. Run only after the request is known to be a real chat from an
 *           allowed site, so junk traffic can never use up the budget that real customers share.
 */
export async function chatBudget(
  hit: Hit,
  phase: 'ip' | 'org',
  who: {ip: string; orgId: string; sessionId: string},
  l: ChatLimits,
  now = Date.now()
): Promise<BudgetResult> {
  const checks: [scope: string, key: string, windowMs: number, max: number][] =
    phase === 'ip'
      ? [
          ['ip-10min', `chat-ip10:${who.ip}`, 10 * MIN, l.ipPer10Min],
          ['ip-day', `chat-ipd:${who.ip}`, DAY, l.ipPerDay],
        ]
      : [
          ['session', `chat-ses:${who.orgId}:${who.sessionId}`, HOUR, l.sessionPerHour],
          ['org-hour', `chat-orgh:${who.orgId}`, HOUR, l.orgPerHour],
          ['org-day', `chat-orgd:${who.orgId}`, DAY, l.orgPerDay],
        ];
  for (const [scope, key, windowMs, max] of checks) {
    const {count, resetAt} = await hit(key, windowMs);
    if (count > max) return {ok: false, scope, retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000))};
  }
  return {ok: true};
}

/**
 * Turns the untrusted request body into the conversation that is sent to the model: valid shape, each message
 * length-capped, only the latest turns within the character budget, and the last message must be from the visitor
 * (otherwise we would pay for the AI to answer itself). Returns null when the body is unusable.
 */
export function prepareTurns(raw: unknown, l: ChatLimits): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null;
  let turns: ChatTurn[] = raw
    .map((m) => (isRecord(m) ? m : {}))
    .map((m) => ({speaker: m.speaker === 'agent' ? ('agent' as const) : ('caller' as const), text: str(m.text, 600)}))
    .filter((t) => t.text);
  if (!turns.length || turns[turns.length - 1].speaker !== 'caller') return null;
  turns = turns.slice(-l.maxTurns);
  let total = turns.reduce((n, t) => n + t.text.length, 0);
  while (turns.length > 1 && total > l.maxChars) total -= turns.shift()!.text.length;
  return turns[turns.length - 1].text.length > l.maxChars ? null : turns;
}
