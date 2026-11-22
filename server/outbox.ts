/**
 * Transactional outbox.
 *
 * Problem this solves: request handlers used to send a text / fire a webhook / write a calendar event BEFORE the workspace was
 * saved. If the save lost an optimistic-lock race the API answered 409, the browser retried the whole request, and the
 * external action ran a second time.
 *
 * Now a handler only calls `enqueue(ws, ...)`. The entry is saved in the same compare-and-set write as the change itself.
 * A lost race stores nothing, so the retry enqueues exactly once. After a successful commit `dispatch(orgId)` claims due
 * entries (a second compare-and-set write, so two servers never claim the same one), performs them, and records the result.
 *
 * Delivery guarantees:
 *   sms      at most once. A crash mid-send leaves the entry "failed: delivery unknown" instead of risking a duplicate text.
 *   webhook  at least once, with a stable event id so receivers can de-duplicate.
 *   gcal     at least once, safe because the Google event id is derived from the appointment id.
 */
import type {OutboxEntry, OutboxKind, TenantWorkspace} from '../src/types/plumbvoice.ts';

export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 60_000;
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000];
const MAX_ENTRIES = 500;
const DAY = 86_400_000;

const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

export interface EnqueueInput {
  id: string;
  dedupeKey: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  after?: OutboxEntry['after'];
  nowISO: string;
}

/** Adds an entry unless one with the same dedupeKey already exists (in any state). Returns the entry and whether it is new. */
export function enqueue(ws: Pick<TenantWorkspace, 'outbox'>, input: EnqueueInput): {entry: OutboxEntry; created: boolean} {
  ws.outbox ??= [];
  const existing = ws.outbox.find((e) => e.dedupeKey === input.dedupeKey);
  // Pending, sending and sent entries block a duplicate. A failed or cancelled one (only possible after a real commit)
  // may be queued again by a deliberate new action.
  if (existing && existing.status !== 'failed' && existing.status !== 'cancelled') return {entry: existing, created: false};
  if (existing) ws.outbox = ws.outbox.filter((e) => e !== existing);
  const entry: OutboxEntry = {
    id: input.id,
    dedupeKey: input.dedupeKey,
    kind: input.kind,
    payload: input.payload,
    status: 'pending',
    attempts: 0,
    nextAttemptISO: input.nowISO,
    createdAtISO: input.nowISO,
    updatedAtISO: input.nowISO,
    after: input.after,
  };
  ws.outbox.push(entry);
  return {entry, created: true};
}

export function hasDue(ws: Pick<TenantWorkspace, 'outbox'>, nowISO: string): boolean {
  return (ws.outbox ?? []).some((e) => (e.status === 'pending' && e.nextAttemptISO <= nowISO) || (e.status === 'sending' && (e.leaseUntilISO ?? '') <= nowISO));
}

/**
 * Takes up to `limit` due entries and marks them "sending" with a lease. Entries whose lease ran out (the server died mid-send)
 * are recovered: texts become "failed, delivery unknown", the idempotent kinds go back to pending.
 */
export function claimDue(ws: Pick<TenantWorkspace, 'outbox'>, nowISO: string, limit = 10): OutboxEntry[] {
  const claimed: OutboxEntry[] = [];
  for (const e of ws.outbox ?? []) {
    if (e.status === 'sending' && (e.leaseUntilISO ?? '') <= nowISO) {
      if (e.kind === 'sms') {
        e.status = 'failed';
        e.lastError = 'Delivery unknown: the server stopped while sending. Not retried to avoid a duplicate text.';
      } else {
        e.status = e.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        e.nextAttemptISO = nowISO;
        e.lastError = 'Interrupted while sending; will retry.';
      }
      e.leaseUntilISO = undefined;
      e.updatedAtISO = nowISO;
    }
  }
  for (const e of ws.outbox ?? []) {
    if (claimed.length >= limit) break;
    if (e.status !== 'pending' || e.nextAttemptISO > nowISO) continue;
    e.status = 'sending';
    e.attempts += 1;
    e.leaseUntilISO = plus(nowISO, LEASE_MS);
    e.updatedAtISO = nowISO;
    claimed.push(e);
  }
  return claimed;
}

export type Outcome = {ok: true} | {ok: false; error: string; permanent?: boolean} | {ok: 'cancelled'; reason: string};

/** Records what happened. Returns the final status so the caller can update the related record. */
export function settle(ws: Pick<TenantWorkspace, 'outbox'>, id: string, outcome: Outcome, nowISO: string): OutboxEntry | undefined {
  const e = (ws.outbox ?? []).find((x) => x.id === id);
  if (!e) return undefined;
  e.leaseUntilISO = undefined;
  e.updatedAtISO = nowISO;
  if (outcome.ok === true) {
    e.status = 'sent';
    e.lastError = undefined;
  } else if (outcome.ok === 'cancelled') {
    e.status = 'cancelled';
    e.lastError = outcome.reason;
  } else {
    e.lastError = outcome.error.slice(0, 200);
    if (outcome.permanent || e.attempts >= MAX_ATTEMPTS) e.status = 'failed';
    else {
      e.status = 'pending';
      e.nextAttemptISO = plus(nowISO, BACKOFF_MS[Math.min(e.attempts - 1, BACKOFF_MS.length - 1)]);
    }
  }
  return e;
}

/** Keeps the list small. Finished entries stay a day (so a dedupeKey still blocks a late retry), failures two weeks. */
export function prune(ws: Pick<TenantWorkspace, 'outbox'>, nowISO: string): void {
  if (!ws.outbox) return;
  ws.outbox = ws.outbox.filter((e) => {
    const age = Date.parse(nowISO) - Date.parse(e.updatedAtISO);
    if (e.status === 'sent' || e.status === 'cancelled') return age < DAY;
    if (e.status === 'failed') return age < 14 * DAY;
    return true;
  });
  if (ws.outbox.length > MAX_ENTRIES) ws.outbox = ws.outbox.slice(-MAX_ENTRIES);
  if (!ws.outbox.length) delete ws.outbox;
}

// ---------- dispatcher ----------

type Mutator = {
  mutateWorkspace(orgId: string, fn: (ws: TenantWorkspace) => void): Promise<void>;
  peekWorkspace(orgId: string): Promise<TenantWorkspace | null>;
};
export type Handler = (ws: TenantWorkspace, entry: OutboxEntry) => Promise<Outcome>;

export function createDispatcher(opts: {
  store: Mutator;
  handlers: Record<OutboxKind, Handler>;
  /** Called inside the same save that records the outcome, so related records change atomically with it. */
  onSettled: (ws: TenantWorkspace, entry: OutboxEntry) => void;
  now?: () => string;
}) {
  const now = opts.now ?? (() => new Date().toISOString());
  const running = new Set<string>();

  return async function dispatch(orgId: string): Promise<number> {
    if (running.has(orgId)) return 0; // another loop in this process is already working through this org
    running.add(orgId);
    let done = 0;
    try {
      for (let round = 0; round < 5; round++) {
        const peek = await opts.store.peekWorkspace(orgId);
        if (!peek || !hasDue(peek, now())) break;
        let claimed: OutboxEntry[] = [];
        let snapshot: TenantWorkspace | null = null;
        await opts.store.mutateWorkspace(orgId, (ws) => {
          claimed = claimDue(ws, now()).map((e) => ({...e}));
          snapshot = JSON.parse(JSON.stringify(ws)) as TenantWorkspace;
        });
        if (!claimed.length || !snapshot) continue;
        for (const entry of claimed as OutboxEntry[]) {
          let outcome: Outcome;
          try {
            outcome = await opts.handlers[entry.kind](snapshot as TenantWorkspace, entry);
          } catch (e) {
            outcome = {ok: false, error: e instanceof Error ? e.message : 'Unexpected error'};
          }
          try {
            await opts.store.mutateWorkspace(orgId, (ws) => {
              const final = settle(ws, entry.id, outcome, now());
              if (final) opts.onSettled(ws, final);
              prune(ws, now());
            });
          } catch (e) {
            console.error('[outbox] could not record result for', entry.id, e instanceof Error ? e.message : e);
          }
          done++;
        }
      }
    } catch (e) {
      console.error('[outbox] dispatch failed:', e instanceof Error ? e.message : e);
    } finally {
      running.delete(orgId);
    }
    return done;
  };
}
