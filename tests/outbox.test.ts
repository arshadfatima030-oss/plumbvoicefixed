import assert from 'node:assert/strict';
import {test} from 'node:test';
import {claimDue, createDispatcher, enqueue, hasDue, prune, settle} from '../server/outbox.ts';
import type {OutboxEntry, TenantWorkspace} from '../src/types/plumbvoice.ts';

const T0 = '2026-11-22T10:00:00.000Z';
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const mk = (id: string, key: string, kind: OutboxEntry['kind'] = 'sms') => ({id, dedupeKey: key, kind, payload: {}, nowISO: T0});

test('same dedupeKey is enqueued once, even after it was sent', () => {
  const ws: Pick<TenantWorkspace, 'outbox'> = {};
  assert.equal(enqueue(ws, mk('a', 'quote:1')).created, true);
  assert.equal(enqueue(ws, mk('b', 'quote:1')).created, false);
  settle(ws, 'a', {ok: true}, T0);
  assert.equal(enqueue(ws, mk('c', 'quote:1')).created, false);
  assert.equal(ws.outbox?.length, 1);
});

test('a save that lost the race stores nothing, so the retry enqueues exactly once', () => {
  // Attempt 1 mutates a copy that is never saved (409). Attempt 2 starts from the stored workspace again.
  const stored: Pick<TenantWorkspace, 'outbox'> = {};
  const attempt1 = JSON.parse(JSON.stringify(stored));
  enqueue(attempt1, mk('x', 'quote:1'));
  const attempt2 = JSON.parse(JSON.stringify(stored));
  enqueue(attempt2, mk('y', 'quote:1'));
  assert.equal(attempt2.outbox.length, 1);
  assert.equal(stored.outbox, undefined);
});

test('claim leases entries; a second claim gets nothing', () => {
  const ws: Pick<TenantWorkspace, 'outbox'> = {};
  enqueue(ws, mk('a', 'k1'));
  assert.equal(claimDue(ws, T0).length, 1);
  assert.equal(claimDue(ws, T0).length, 0);
  assert.equal(ws.outbox?.[0].attempts, 1);
});

test('failure backs off and gives up after the maximum attempts', () => {
  const ws: Pick<TenantWorkspace, 'outbox'> = {};
  enqueue(ws, mk('a', 'k1', 'webhook'));
  let now = T0;
  for (let i = 0; i < 5; i++) {
    assert.equal(claimDue(ws, now).length, 1, `attempt ${i + 1}`);
    settle(ws, 'a', {ok: false, error: 'boom'}, now);
    if (i < 4) {
      assert.equal(ws.outbox?.[0].status, 'pending');
      assert.equal(claimDue(ws, now).length, 0, 'not due yet');
      now = ws.outbox![0].nextAttemptISO;
    }
  }
  assert.equal(ws.outbox?.[0].status, 'failed');
});

test('expired lease: texts are NOT resent, webhooks are retried', () => {
  const ws: Pick<TenantWorkspace, 'outbox'> = {};
  enqueue(ws, mk('s', 'sms1', 'sms'));
  enqueue(ws, mk('w', 'wh1', 'webhook'));
  assert.equal(claimDue(ws, T0).length, 2);
  assert.equal(hasDue(ws, at(30)), false);
  assert.equal(hasDue(ws, at(61)), true);
  const reclaimed = claimDue(ws, at(61));
  assert.deepEqual(reclaimed.map((e) => e.id), ['w']);
  assert.equal(ws.outbox?.find((e) => e.id === 's')?.status, 'failed');
});

test('prune drops old finished entries but keeps recent ones and pending ones', () => {
  const ws: Pick<TenantWorkspace, 'outbox'> = {};
  enqueue(ws, mk('old', 'a'));
  enqueue(ws, mk('new', 'b'));
  enqueue(ws, mk('pend', 'c'));
  settle(ws, 'old', {ok: true}, T0);
  settle(ws, 'new', {ok: true}, at(86_400 + 10));
  prune(ws, at(86_400 + 20));
  assert.deepEqual(ws.outbox?.map((e) => e.id).sort(), ['new', 'pend']);
});

test('dispatcher sends once, records the result, and never double-sends under concurrent calls', async () => {
  let ws: TenantWorkspace = {outbox: []} as unknown as TenantWorkspace;
  enqueue(ws, mk('a', 'quote:1'));
  const store = {
    peekWorkspace: async () => JSON.parse(JSON.stringify(ws)) as TenantWorkspace,
    mutateWorkspace: async (_o: string, fn: (w: TenantWorkspace) => void) => {
      const copy = JSON.parse(JSON.stringify(ws)) as TenantWorkspace;
      fn(copy);
      ws = copy;
    },
  };
  let sends = 0;
  const settled: string[] = [];
  const dispatch = createDispatcher({
    store,
    handlers: {
      sms: async () => {
        sends++;
        await new Promise((r) => setTimeout(r, 10));
        return {ok: true};
      },
      webhook: async () => ({ok: true}),
      gcal: async () => ({ok: true}),
    },
    onSettled: (_w, e) => settled.push(`${e.id}:${e.status}`),
    now: () => T0,
  });
  await Promise.all([dispatch('org'), dispatch('org'), dispatch('org')]);
  assert.equal(sends, 1);
  assert.deepEqual(settled, ['a:sent']);
  await dispatch('org');
  assert.equal(sends, 1);
});

test('a throwing handler is retried later, not lost', async () => {
  let ws: TenantWorkspace = {outbox: []} as unknown as TenantWorkspace;
  enqueue(ws, mk('a', 'k', 'webhook'));
  const store = {
    peekWorkspace: async () => JSON.parse(JSON.stringify(ws)) as TenantWorkspace,
    mutateWorkspace: async (_o: string, fn: (w: TenantWorkspace) => void) => {
      const copy = JSON.parse(JSON.stringify(ws)) as TenantWorkspace;
      fn(copy);
      ws = copy;
    },
  };
  const dispatch = createDispatcher({
    store,
    handlers: {sms: async () => ({ok: true}), webhook: async () => { throw new Error('down'); }, gcal: async () => ({ok: true})},
    onSettled: () => {},
    now: () => T0,
  });
  await dispatch('org');
  assert.equal(ws.outbox?.[0].status, 'pending');
  assert.equal(ws.outbox?.[0].lastError, 'down');
});

test('a failed entry can be queued again by a new deliberate action; a sent one cannot', () => {
  const ws: Pick<TenantWorkspace, 'outbox'> = {};
  enqueue(ws, mk('a', 'review:1'));
  claimDue(ws, T0);
  settle(ws, 'a', {ok: false, error: 'x', permanent: true}, T0);
  assert.equal(ws.outbox?.[0].status, 'failed');
  const again = enqueue(ws, mk('b', 'review:1'));
  assert.equal(again.created, true);
  assert.equal(ws.outbox?.length, 1);
  assert.equal(ws.outbox?.[0].status, 'pending');
  claimDue(ws, T0);
  settle(ws, 'b', {ok: true}, T0);
  assert.equal(enqueue(ws, mk('c', 'review:1')).created, false);
});
