import assert from 'node:assert/strict';
import test from 'node:test';
import {needsStepUp} from '../server/stepUpPolicy.ts';

test('sensitive writes, destructive actions and bulk exports need step-up', () => {
  for (const [m, p] of [
    ['PATCH', '/extras'], ['POST', '/extras/webhook/test'], ['PATCH', '/agent-config'], ['POST', '/knowledge/approve'],
    ['POST', '/integrations/google/disconnect'], ['DELETE', '/leads/abc'], ['POST', '/leads/merge'], ['DELETE', '/calls/c1/recording'],
    ['GET', '/export/json'], ['GET', '/leads/export/csv'], ['GET', '/tools/token'], ['GET', '/extras/ring-token'], ['POST', '/extras/ring-token/rotate'],
    ['POST', '/team'], ['PATCH', '/team/t1'], ['DELETE', '/team/t1'], ['PATCH', '/billing'], ['POST', '/billing/checkout'], ['POST', '/billing/portal'], ['POST', '/auth/change-password'],
  ] as const) assert.equal(needsStepUp(m, p, {}), true, `${m} ${p}`);
});

test('ordinary day-to-day work does not nag', () => {
  for (const [m, p] of [
    ['POST', '/leads'], ['PATCH', '/leads/abc'], ['PATCH', '/appointments/a1'], ['GET', '/leads'], ['GET', '/workspace'],
    ['GET', '/calls/c1/recording'], ['POST', '/agent/converse'], ['PATCH', '/notifications/n1/read'],
  ] as const) assert.equal(needsStepUp(m, p, {}), false, `${m} ${p}`);
});

test('settings and phone setup need a code only when they change where alerts or calls go', () => {
  assert.equal(needsStepUp('PATCH', '/settings', {businessName: 'Acme'}), false);
  assert.equal(needsStepUp('PATCH', '/settings', {dispatchEmail: 'x@y.com'}), true);
  assert.equal(needsStepUp('PATCH', '/settings', {emergencyRules: {escalateToPhone: '+15125550100'}}), true);
  assert.equal(needsStepUp('PATCH', '/settings', {notificationPreferences: {smsOnEmergency: false}}), true);
  assert.equal(needsStepUp('PATCH', '/settings', {workingHours: []}), false);
  assert.equal(needsStepUp('PATCH', '/phone-setup', {ringTimeoutSec: 20}), false);
  assert.equal(needsStepUp('PATCH', '/phone-setup', {businessPhone: '+15125550100'}), true);
  assert.equal(needsStepUp('PATCH', '/settings', undefined), false);
});

test('trailing slashes and method case do not bypass the policy', () => {
  assert.equal(needsStepUp('patch', '/extras/', {}), true);
  assert.equal(needsStepUp('DELETE', '/leads/abc/', {}), true);
});
