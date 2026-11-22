import assert from 'node:assert/strict';
import {test} from 'node:test';
import {technicianView} from '../server/techView.ts';
import type {TenantWorkspace} from '../src/types/plumbvoice.ts';

const ws = {
  organizationId: 'org1',
  calls: [{id: 'c1'}],
  leads: [
    {id: 'l1', organizationId: 'org1', name: 'Ann', phone: '555', email: 'ann@x.com', estimatedValue: 4200, leadSource: 'AI Phone Receptionist', linkedCallId: 'c1', callDurationSec: 99, internalNotes: 'gate code 1234', secretExtra: 'nope'},
    {id: 'l2', organizationId: 'org1', name: 'Bob', phone: '556', email: 'bob@x.com', estimatedValue: 100},
  ],
  appointments: [{id: 'a1', organizationId: 'org1', title: 'Fix', customerName: 'Ann', customerPhone: '555', address: '1 Main', estimatedValue: 4200, googleEventId: 'gcal-evt-77', googleSynced: true, assignedMemberId: 't1', status: 'Scheduled'}],
  followUps: [{id: 'f1'}], notifications: [{id: 'n1'}], quotes: [{id: 'q1'}], reminders: [{id: 'r1'}],
  team: [{id: 't1', email: 't@x.com'}, {id: 't2', email: 'o@x.com'}],
  voiceAgent: {prompt: 'secret prompt'},
  phoneSetup: {number: '+1555'},
  settings: {businessName: 'Acme', timezone: 'UTC', alertPhone: '+1999'},
  extras: {webhook: {url: 'https://h', enabled: true, events: []}, ringFirst: {ownerPhone: '+1888'}, smsOptOut: ['+1777']},
  billing: {plan: 'Business', paymentMethodLast4: '4242', invoices: [{id: 'i1'}]},
  onboardingCompleted: false,
} as unknown as TenantWorkspace;

test('technician view exposes only own jobs, with no money, config, contacts of others or billing', () => {
  const v = technicianView(ws, ws.team[0], (l) => l.id === 'l1', () => true);
  const json = JSON.stringify(v);
  for (const leak of ['4200', 'ann@x.com', 'bob@x.com', 'secret prompt', '+1555"', '+1888', '+1777', 'https://h', '4242', 'Business', 'o@x.com', 'gcal-evt-77', 'secretExtra', 'AI Phone Receptionist', '+1999']) {
    assert.ok(!json.includes(leak), `leaked: ${leak}`);
  }
  assert.equal(v.leads.length, 1);
  assert.equal(v.leads[0].internalNotes, 'gate code 1234'); // the technician appends to these notes
  assert.equal(v.appointments[0].address, '1 Main');
  assert.equal(v.team.length, 1);
  assert.equal(v.settings.businessName, 'Acme');
  assert.equal(v.onboardingCompleted, true);
  assert.deepEqual([v.calls, v.followUps, v.notifications, v.quotes, v.reminders], [[], [], [], [], []]);
  assert.equal((v as unknown as {extras?: unknown}).extras, undefined);
});
