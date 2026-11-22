import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {TenantWorkspace} from '../src/types/plumbvoice.ts';
import {recordPaidInvoice} from '../server/stripe.ts';

const ws = (plan: string, extra: Record<string, unknown> = {}) =>
  ({billing: {plan, minutesUsed: 0, minutesIncluded: 250, invoices: [], ...extra}}) as unknown as TenantWorkspace;

async function load(stripeOn: boolean) {
  if (stripeOn) {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_STARTER = 'p1';
    process.env.STRIPE_PRICE_PROFESSIONAL = 'p2';
    process.env.STRIPE_PRICE_BUSINESS = 'p3';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
  } else {
    delete process.env.STRIPE_SECRET_KEY;
  }
  return import('../server/access.ts');
}

test('without Stripe every feature stays open', async () => {
  const {planAllows} = await load(false);
  assert.equal(planAllows(ws('Starter'), 'calendar'), true);
});

test('with Stripe: Starter is locked out of Professional features, Professional is not', async () => {
  const {planAllows} = await load(true);
  const active = {subscriptionStatus: 'active'};
  assert.equal(planAllows(ws('Starter', active), 'calendar'), false);
  assert.equal(planAllows(ws('Starter', active), 'webhooks'), false);
  assert.equal(planAllows(ws('Professional', active), 'calendar'), true);
  assert.equal(planAllows(ws('Business', active), 'knowledgeImport'), true);
});

test('with Stripe: a free trial can try everything, a blocked workspace nothing', async () => {
  const {planAllows} = await load(true);
  assert.equal(planAllows(ws('Starter', {trialStartedAtISO: new Date().toISOString()}), 'ringFirst'), true);
  assert.equal(planAllows(ws('Business', {subscriptionStatus: 'unpaid'}), 'ringFirst'), false);
});

test('a new paid invoice resets used minutes; the same invoice twice does not reset again', () => {
  const w = ws('Professional', {minutesUsed: 900, usageNotice: 80});
  recordPaidInvoice(w, {id: 'in_1', amount_paid: 24900, created: 1_700_000_000});
  assert.equal(w.billing.minutesUsed, 0);
  assert.equal(w.billing.usageNotice, undefined);
  w.billing.minutesUsed = 30;
  recordPaidInvoice(w, {id: 'in_1', amount_paid: 24900, created: 1_700_000_000});
  assert.equal(w.billing.minutesUsed, 30);
});
