import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkSmsConsent, grantSmsConsent, restoreSmsConsent, revokeSmsConsent} from '../server/consent.ts';

const P = '+15551234567';
const T0 = '2026-11-22T10:00:00.000Z';

test('no record means no consent for any purpose', () => {
  const ws = {};
  for (const k of ['service', 'review_request', 'maintenance_reminder'] as const) {
    const r = checkSmsConsent(ws, P, k);
    assert.equal(r.ok, false);
  }
});

test('grant stores source, timestamp and only the purposes given', () => {
  const ws: Parameters<typeof grantSmsConsent>[0] = {};
  grantSmsConsent(ws, {phone: P, purposes: ['service'], source: 'booking_page', evidence: 'checkbox v1', nowISO: T0});
  const ok = checkSmsConsent(ws, P, 'service');
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.record.source, 'booking_page');
    assert.equal(ok.record.capturedAtISO, T0);
  }
  const review = checkSmsConsent(ws, P, 'review_request');
  assert.deepEqual(review, {ok: false, reason: 'purpose-not-covered'});
});

test('purposes accumulate and keep an audit history', () => {
  const ws: Parameters<typeof grantSmsConsent>[0] = {};
  grantSmsConsent(ws, {phone: P, purposes: ['service'], source: 'booking_page', nowISO: T0});
  grantSmsConsent(ws, {phone: P, purposes: ['review_request'], source: 'verbal_staff', evidence: 'Called Ana 11/22', nowISO: '2026-11-22T11:00:00.000Z'});
  assert.ok(checkSmsConsent(ws, P, 'service').ok);
  assert.ok(checkSmsConsent(ws, P, 'review_request').ok);
  assert.equal(ws.extras?.smsConsents?.length, 1);
  assert.equal(ws.extras?.smsConsents?.[0].history?.length, 1);
});

test('STOP overrides consent, withdrawal blocks, START restores the old record only', () => {
  const ws: Parameters<typeof grantSmsConsent>[0] = {};
  grantSmsConsent(ws, {phone: P, purposes: ['service'], source: 'booking_page', nowISO: T0});
  ws.extras!.smsOptOut = [P];
  assert.deepEqual(checkSmsConsent(ws, P, 'service'), {ok: false, reason: 'opted-out'});
  ws.extras!.smsOptOut = [];
  assert.equal(revokeSmsConsent(ws, P, T0), true);
  assert.deepEqual(checkSmsConsent(ws, P, 'service'), {ok: false, reason: 'revoked'});
  assert.equal(restoreSmsConsent(ws, P), true);
  assert.ok(checkSmsConsent(ws, P, 'service').ok);
  assert.equal(restoreSmsConsent(ws, '+15550000000'), false); // START never creates consent
});

test('a fresh grant after withdrawal starts a new record', () => {
  const ws: Parameters<typeof grantSmsConsent>[0] = {};
  grantSmsConsent(ws, {phone: P, purposes: ['service'], source: 'booking_page', nowISO: T0});
  revokeSmsConsent(ws, P, T0);
  grantSmsConsent(ws, {phone: P, purposes: ['service'], source: 'written_form', nowISO: '2026-12-01T00:00:00.000Z'});
  const r = checkSmsConsent(ws, P, 'service');
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.record.source, 'written_form');
  assert.equal(ws.extras?.smsConsents?.length, 1);
});
