import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {TenantWorkspace} from '../src/types/plumbvoice.ts';
import {routeLocation, buildEmergencyAlert} from '../server/rules.ts';
import {purgeExpiredRecordings} from '../server/store.ts';

const loc = (id: string, name: string, zips: string[], phone = '') => ({id, name, address: '', zips, phone, hours: '', teamMemberIds: []});
const base = (extras: Record<string, unknown> = {}, calls: unknown[] = []) =>
  ({
    extras,
    calls,
    settings: {notificationPreferences: {smsOnEmergency: true}, emergencyRules: {escalateToPhone: '+15550100001'}},
  }) as unknown as TenantWorkspace;

test('routes by ZIP, then by a ZIP the caller said, otherwise to nobody', () => {
  const ws = base({locations: [loc('loc-a', 'North', ['75001']), loc('loc-b', 'South', ['75002'])]});
  assert.equal(routeLocation(ws, '75002')?.name, 'South');
  assert.equal(routeLocation(ws, '', 'I am at 75001 on Main street')?.name, 'North');
  assert.equal(routeLocation(ws, '99999', 'no zip here'), null);
  assert.equal(routeLocation(base(), '75001'), null);
});

test('emergency text goes to the location number, else the main number', () => {
  const ws = base();
  const a = buildEmergencyAlert(ws, '+15551110000', 'burst pipe', 'l1', loc('loc-a', 'North', ['75001'], '+15550100002'));
  assert.equal(a?.to, '+15550100002');
  assert.match(a?.text ?? '', /\[North\]/);
  assert.equal(buildEmergencyAlert(ws, '+15551110000', 'burst pipe', 'l1', null)?.to, '+15550100001');
});

test('retention removes only old audio and keeps the call itself', () => {
  const now = Date.parse('2026-11-22T00:00:00Z');
  const old = {id: 'c1', recordingUrl: 'https://x/a.mp3', recordingAvailable: true, createdAtISO: '2026-08-01T00:00:00Z'};
  const fresh = {id: 'c2', recordingUrl: 'https://x/b.mp3', recordingAvailable: true, createdAtISO: '2026-11-20T00:00:00Z'};
  const ws = base({recording: {consentNotice: '', retentionDays: 30}}, [old, fresh]);
  assert.equal(purgeExpiredRecordings(ws, now), 1);
  assert.equal((ws.calls[0] as typeof old).recordingUrl, undefined);
  assert.equal((ws.calls[0] as typeof old).recordingAvailable, false);
  assert.ok((ws.calls[1] as typeof fresh).recordingUrl);
  const keep = base({recording: {consentNotice: '', retentionDays: 0}}, [{...old}]);
  assert.equal(purgeExpiredRecordings(keep, now), 0);
});

import crypto from 'node:crypto';
import {texmlSignatureOk, texmlSignatureRequired} from '../server/telnyx.ts';

test('TeXML signature: signed requests must verify; unsigned ones depend on TEXML_REQUIRE_SIGNATURE', () => {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({type: 'spki', format: 'der'}) as Buffer;
  const prev = process.env.TELNYX_PUBLIC_KEY;
  process.env.TELNYX_PUBLIC_KEY = der.subarray(der.length - 32).toString('base64');
  try {
    const body = Buffer.from('CallSid=abc&From=%2B15555550100');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.sign(null, Buffer.concat([Buffer.from(`${ts}|`), body]), privateKey).toString('base64');
    assert.equal(texmlSignatureOk(body, sig, ts, true), true);
    assert.equal(texmlSignatureOk(Buffer.from('tampered'), sig, ts, false), false, 'bad signature is refused even when not required');
    assert.equal(texmlSignatureOk(body, undefined, undefined, false), true, 'unsigned allowed while not required');
    assert.equal(texmlSignatureOk(body, undefined, undefined, true), false, 'unsigned refused when required');
    delete process.env.TELNYX_PUBLIC_KEY;
    assert.equal(texmlSignatureOk(body, sig, ts, true), false, 'no public key configured: fail closed');
  } finally {
    if (prev === undefined) delete process.env.TELNYX_PUBLIC_KEY;
    else process.env.TELNYX_PUBLIC_KEY = prev;
  }
});

test('TeXML signature is required by default in production and can be overridden explicitly', () => {
  assert.equal(texmlSignatureRequired({NODE_ENV: 'production'}), true);
  assert.equal(texmlSignatureRequired({NODE_ENV: 'development'}), false);
  assert.equal(texmlSignatureRequired({}), false);
  assert.equal(texmlSignatureRequired({NODE_ENV: 'production', TEXML_REQUIRE_SIGNATURE: 'false'}), false);
  assert.equal(texmlSignatureRequired({NODE_ENV: 'development', TEXML_REQUIRE_SIGNATURE: 'true'}), true);
});

import {isSlotFree, upsertEvent, parseWindow, WINDOW_FORMAT_ERROR} from '../server/gcal.ts';

test('calendar: free-text windows are never treated as free and never become a guessed 9-11 event', async () => {
  assert.equal(parseWindow('10:00 AM – 12:00 PM')?.start, 600);
  assert.equal(parseWindow('morning'), null);
  await assert.rejects(() => isSlotFree('t', 'primary', '2026-12-01', 'morning', 'America/Chicago'), {message: WINDOW_FORMAT_ERROR});
  await assert.rejects(
    () => upsertEvent('t', 'primary', {id: 'a1', title: 'x', customerName: 'c', customerPhone: '', address: '', dateISO: '2026-12-01', timeWindow: 'afternoon'} as never, 'America/Chicago'),
    {message: WINDOW_FORMAT_ERROR}
  );
});
