import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LIMITS, PlumbVoiceStore, teamHasRoom} from '../server/store.ts';
import type {TenantWorkspace} from '../src/types/plumbvoice.ts';

// Minimal in-memory storage: only the two methods mutateWorkspace needs.
function fakeStore(ws: TenantWorkspace) {
  let saved = ws;
  const storage = {
    getWorkspace: async () => ({ws: JSON.parse(JSON.stringify(saved)) as TenantWorkspace, version: 1}),
    saveWorkspace: async (_id: string, next: TenantWorkspace) => {
      saved = next;
      return 2;
    },
  };
  return {store: new PlumbVoiceStore(storage as never), get: () => saved};
}

const base = (): TenantWorkspace =>
  ({organizationId: 'org1', calls: [], leads: [], appointments: [], followUps: [], notifications: []}) as unknown as TenantWorkspace;

test('background mutations (webhooks, public booking, tool callbacks) cannot exceed the record limits', async () => {
  const {store, get} = fakeStore(base());
  await store.mutateWorkspace('org1', (ws) => {
    for (let i = 0; i < 1500; i++) ws.calls.unshift({id: `c${i}`} as never);
    for (let i = 0; i < 2500; i++) ws.leads.unshift({id: `l${i}`} as never);
    for (let i = 0; i < 2500; i++) ws.followUps.unshift({id: `f${i}`} as never);
  });
  assert.equal(get().calls.length, 1000);
  assert.equal(get().leads.length, 2000);
  assert.equal(get().followUps.length, 2000);
  assert.equal(get().calls[0].id, 'c1499', 'newest records are kept');
});

test('the owner is told once when records start being dropped', async () => {
  const {store, get} = fakeStore(base());
  for (let round = 0; round < 3; round++) {
    await store.mutateWorkspace('org1', (ws) => {
      for (let i = 0; i < 1100; i++) ws.calls.unshift({id: `c${round}-${i}`} as never);
    });
  }
  assert.equal(get().notifications.filter((n) => n.title === 'Record limit reached: calls').length, 1);
});

test('test-agent records are dropped before real ones', async () => {
  const {store, get} = fakeStore(base());
  await store.mutateWorkspace('org1', (ws) => {
    for (let i = 0; i < 1000; i++) ws.leads.push({id: `real${i}`} as never);
    for (let i = 0; i < 1100; i++) ws.leads.unshift({id: `test${i}`, isTest: true} as never);
  });
  assert.equal(get().leads.length, 2000);
  assert.equal(get().leads.filter((l) => l.isTest).length, 1000);
  assert.equal(get().leads.filter((l) => !l.isTest).length, 1000);
});

test('appointments are capped and the owner is told', async () => {
  const {store, get} = fakeStore(base());
  await store.mutateWorkspace('org1', (ws) => {
    for (let i = 0; i < LIMITS.appointments + 50; i++) ws.appointments.unshift({id: `a${i}`} as never);
  });
  assert.equal(get().appointments.length, LIMITS.appointments);
  assert.equal(get().appointments[0].id, `a${LIMITS.appointments + 49}`);
  assert.equal(get().notifications.filter((n) => n.title === 'Record limit reached: appointments').length, 1);
});

test('follow-ups are capped and the owner is told', async () => {
  const {store, get} = fakeStore(base());
  await store.mutateWorkspace('org1', (ws) => {
    for (let i = 0; i < LIMITS.followUps + 10; i++) ws.followUps.unshift({id: `f${i}`} as never);
  });
  assert.equal(get().followUps.length, LIMITS.followUps);
  assert.equal(get().notifications.filter((n) => n.title === 'Record limit reached: follow-ups').length, 1);
});

test('quotes are capped centrally (no route has to remember) and the owner is told', async () => {
  const {store, get} = fakeStore(base());
  await store.mutateWorkspace('org1', (ws) => {
    ws.quotes = [];
    for (let i = 0; i < LIMITS.quotes + 20; i++) ws.quotes.unshift({id: `q${i}`} as never);
  });
  assert.equal(get().quotes?.length, LIMITS.quotes);
  assert.equal(get().quotes?.[0].id, `q${LIMITS.quotes + 19}`);
  assert.equal(get().notifications.filter((n) => n.title === 'Record limit reached: quotes').length, 1);
});

test('dropping only Test Agent records does not alarm the owner', async () => {
  const {store, get} = fakeStore(base());
  await store.mutateWorkspace('org1', (ws) => {
    for (let i = 0; i < 100; i++) ws.leads.push({id: `real${i}`} as never);
    for (let i = 0; i < LIMITS.leads; i++) ws.leads.unshift({id: `test${i}`, isTest: true} as never);
  });
  assert.equal(get().leads.filter((l) => !l.isTest).length, 100, 'every real lead survived');
  assert.equal(get().notifications.length, 0);
});

test('each kind of record gets its own notice, once, until it is read', async () => {
  const {store, get} = fakeStore(base());
  for (let round = 0; round < 2; round++) {
    await store.mutateWorkspace('org1', (ws) => {
      for (let i = 0; i < LIMITS.calls + 5; i++) ws.calls.unshift({id: `c${round}-${i}`} as never);
      for (let i = 0; i < LIMITS.appointments + 5; i++) ws.appointments.unshift({id: `a${round}-${i}`} as never);
    });
  }
  const titles = get().notifications.map((n) => n.title).sort();
  assert.deepEqual(titles, ['Record limit reached: appointments', 'Record limit reached: calls']);
  // once the owner reads one, the next removal tells them again
  get().notifications.forEach((n) => (n.read = true));
  await store.mutateWorkspace('org1', (ws) => {
    ws.calls.unshift({id: 'extra'} as never);
  });
  assert.equal(get().notifications.filter((n) => n.title === 'Record limit reached: calls').length, 2);
});

test('team size is a hard cap and members are never removed by the limits pass', async () => {
  const ws = base();
  ws.team = Array.from({length: LIMITS.team - 1}, (_, i) => ({id: `t${i}`})) as never;
  assert.equal(teamHasRoom(ws), true);
  ws.team.push({id: 'last'} as never);
  assert.equal(teamHasRoom(ws), false);
  const {store, get} = fakeStore(ws);
  await store.mutateWorkspace('org1', (w) => {
    w.team.push({id: 'over'} as never); // even if something slipped past the route check
  });
  assert.equal(get().team.length, LIMITS.team + 1, 'staff accounts are not silently deleted');
});

test('notifications are capped at 200 and the newest are kept', async () => {
  const {store, get} = fakeStore(base());
  await store.mutateWorkspace('org1', (ws) => {
    for (let i = 0; i < 250; i++) ws.notifications.push({id: `n${i}`, title: `n${i}`, read: true} as never);
  });
  assert.equal(get().notifications.length, 200);
  assert.equal(get().notifications[0].id, 'n0', 'list is newest-first, so the oldest tail is cut');
});

test('many simultaneous background writers all succeed and still respect the limits', async () => {
  const {MemoryStorage} = await import('../server/storage.ts');
  const storage = new MemoryStorage(null);
  const ws = {...base(), team: [], quotes: []} as unknown as TenantWorkspace;
  (storage as unknown as {workspaces: Map<string, unknown>}).workspaces.set('org1', {ws, version: 1});
  const store = new PlumbVoiceStore(storage as never);
  await Promise.all(
    Array.from({length: 20}, (_, k) =>
      store.mutateWorkspace('org1', (w) => {
        for (let i = 0; i < 100; i++) w.calls.unshift({id: `c${k}-${i}`} as never);
      })
    )
  );
  const cur = await storage.getWorkspace('org1');
  assert.equal(cur?.ws.calls.length, LIMITS.calls);
  assert.equal(cur?.ws.notifications.filter((n) => n.title === 'Record limit reached: calls').length, 1);
});
