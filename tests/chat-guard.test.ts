import assert from 'node:assert/strict';
import test from 'node:test';
import {chatBudget, chatLimits, prepareTurns, type Hit} from '../server/chatGuard.ts';

const counter = (): {hit: Hit; keys: string[]} => {
  const m = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    hit: async (key, windowMs) => {
      keys.push(key);
      const n = (m.get(key) ?? 0) + 1;
      m.set(key, n);
      return {count: n, resetAt: Date.now() + windowMs};
    },
  };
};
const L = {...chatLimits({}), ipPer10Min: 3, ipPerDay: 100, sessionPerHour: 100, orgPerHour: 5, orgPerDay: 100};

test('one IP is refused at the IP phase and never touches the shared business budget', async () => {
  const {hit, keys} = counter();
  const who = {ip: '1.2.3.4', orgId: 'org1', sessionId: 'sess-12345678'};
  for (let i = 0; i < 3; i++) assert.equal((await chatBudget(hit, 'ip', who, L)).ok, true);
  const r = await chatBudget(hit, 'ip', who, L);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.scope, 'ip-10min');
  assert.ok(r.ok === false && r.retryAfterSec >= 1);
  assert.equal(keys.filter((k) => k.startsWith('chat-org')).length, 0);
});

test('business-wide hourly cap stops a distributed flood', async () => {
  const {hit} = counter();
  let blocked = 0;
  for (let i = 0; i < 8; i++) {
    const r = await chatBudget(hit, 'org', {ip: `9.9.9.${i}`, orgId: 'org1', sessionId: `sess-${i}0000000`}, L);
    if (!r.ok) blocked++;
  }
  assert.equal(blocked, 3); // 5 allowed, the other 3 refused
});

test('a rotating session id cannot dodge the IP limit, and one session cannot hog the org', async () => {
  const {hit} = counter();
  const l = {...L, sessionPerHour: 2};
  const who = {ip: '5.5.5.5', orgId: 'org1', sessionId: 'same-session-1'};
  assert.equal((await chatBudget(hit, 'org', who, l)).ok, true);
  assert.equal((await chatBudget(hit, 'org', who, l)).ok, true);
  const r = await chatBudget(hit, 'org', who, l);
  assert.equal(r.ok === false && r.scope, 'session');
});

test('prepareTurns keeps only recent turns within the character budget', () => {
  const raw = Array.from({length: 40}, (_, i) => ({speaker: i % 2 ? 'agent' : 'caller', text: `message number ${i} ` + 'x'.repeat(500)}));
  raw.push({speaker: 'caller', text: 'my sink is leaking'});
  const turns = prepareTurns(raw.slice(-40), {...chatLimits({}), maxTurns: 6, maxChars: 1500});
  assert.ok(turns);
  assert.ok(turns!.length <= 6);
  assert.ok(turns!.reduce((n, t) => n + t.text.length, 0) <= 1500 + 600);
  assert.equal(turns![turns!.length - 1].text, 'my sink is leaking');
});

test('prepareTurns rejects empty, oversize, malformed and agent-last conversations', () => {
  const l = chatLimits({});
  assert.equal(prepareTurns([], l), null);
  assert.equal(prepareTurns('hello', l), null);
  assert.equal(prepareTurns(Array.from({length: 41}, () => ({speaker: 'caller', text: 'hi'})), l), null);
  assert.equal(prepareTurns([{speaker: 'caller', text: 'hi'}, {speaker: 'agent', text: 'hello'}], l), null);
  assert.equal(prepareTurns([{text: '   '}], l), null);
  assert.equal(prepareTurns([{speaker: 'caller', text: 'a'.repeat(5000)}], l)![0].text.length, 600); // per-message cap
});

test('env overrides are clamped to sane bounds', () => {
  const l = chatLimits({CHAT_ORG_PER_DAY: '999999999', CHAT_MAX_TURNS: '-4', CHAT_IP_PER_10MIN: 'abc'});
  assert.equal(l.orgPerDay, 1_000_000);
  assert.equal(l.maxTurns, 2);
  assert.equal(l.ipPer10Min, 20);
});
