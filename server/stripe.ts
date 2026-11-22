import crypto from 'node:crypto';
import type {PlanTier, TenantWorkspace} from '../src/types/plumbvoice.ts';
import {PLAN_MINUTES} from './store.ts';

/**
 * Stripe subscription billing (Checkout + Customer Portal + webhook sync). Talks to the Stripe REST API directly,
 * so no extra npm package is needed.
 *
 * Env:
 *   STRIPE_SECRET_KEY            sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET        whsec_… for the endpoint https://YOUR_APP/api/webhooks/stripe
 *   STRIPE_PRICE_STARTER, STRIPE_PRICE_PROFESSIONAL, STRIPE_PRICE_BUSINESS         monthly Price IDs (required)
 *   STRIPE_PRICE_STARTER_ANNUAL, STRIPE_PRICE_PROFESSIONAL_ANNUAL, STRIPE_PRICE_BUSINESS_ANNUAL   optional
 *
 * Stripe is the source of truth: the workspace's plan, status and invoices are only ever changed from a verified
 * Stripe webhook, and each webhook re-fetches the subscription from Stripe instead of trusting the payload.
 */

const API = 'https://api.stripe.com/v1';
const API_VERSION = '2024-06-20';
const PLANS: PlanTier[] = ['Starter', 'Professional', 'Business'];
export type Cycle = 'monthly' | 'annual';

const env = (k: string) => (process.env[k] || '').trim();
const PRICE_ENV: Record<PlanTier, Record<Cycle, string>> = {
  Starter: {monthly: 'STRIPE_PRICE_STARTER', annual: 'STRIPE_PRICE_STARTER_ANNUAL'},
  Professional: {monthly: 'STRIPE_PRICE_PROFESSIONAL', annual: 'STRIPE_PRICE_PROFESSIONAL_ANNUAL'},
  Business: {monthly: 'STRIPE_PRICE_BUSINESS', annual: 'STRIPE_PRICE_BUSINESS_ANNUAL'},
};

export function stripeConfigured(): boolean {
  return Boolean(env('STRIPE_SECRET_KEY') && env('STRIPE_WEBHOOK_SECRET') && PLANS.every((p) => env(PRICE_ENV[p].monthly)));
}

export const priceIdFor = (plan: PlanTier, cycle: Cycle): string => env(PRICE_ENV[plan][cycle]);

function planForPrice(priceId: string): {plan: PlanTier; cycle: Cycle} | null {
  if (!priceId) return null;
  for (const plan of PLANS) {
    for (const cycle of ['monthly', 'annual'] as const) {
      if (env(PRICE_ENV[plan][cycle]) === priceId) return {plan, cycle};
    }
  }
  return null;
}

// ---------- REST helper ----------

type Param = string | number | boolean | null | undefined | Param[] | {[k: string]: Param};

/** Stripe wants form-encoded bodies with bracket notation for nesting: a[b]=1, items[0][price]=x. */
function encodeForm(params: {[k: string]: Param}): string {
  const out: string[] = [];
  const walk = (key: string, v: Param) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${key}[${i}]`, item));
    else if (typeof v === 'object') for (const [k, inner] of Object.entries(v)) walk(`${key}[${k}]`, inner);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join('&');
}

export class StripeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function stripeCall<T>(method: 'GET' | 'POST', path: string, params: {[k: string]: Param} = {}): Promise<T> {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new StripeError('Stripe is not configured.', 503);
  const body = encodeForm(params);
  const url = method === 'GET' && body ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': API_VERSION,
      ...(method === 'POST' ? {'Content-Type': 'application/x-www-form-urlencoded'} : {}),
    },
    body: method === 'POST' ? body : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {error?: {message?: string}};
  if (!res.ok) {
    console.error(`[stripe] ${method} ${path} failed (${res.status}): ${data.error?.message ?? 'unknown error'}`);
    throw new StripeError(data.error?.message ?? `Stripe error (${res.status})`, res.status);
  }
  return data as T;
}

// ---------- Checkout + portal ----------

export async function createCheckoutSession(opts: {
  orgId: string;
  email: string;
  plan: PlanTier;
  cycle: Cycle;
  customerId?: string;
  /** Days of the in-app trial still left; Stripe then starts charging only when the trial would have ended. */
  trialDays?: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const price = priceIdFor(opts.plan, opts.cycle);
  if (!price) throw new StripeError(`The ${opts.cycle} ${opts.plan} price is not set up yet.`, 400);
  const meta = {organizationId: opts.orgId, plan: opts.plan};
  const session = await stripeCall<{url?: string}>('POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: [{price, quantity: 1}],
    client_reference_id: opts.orgId,
    ...(opts.customerId ? {customer: opts.customerId} : {customer_email: opts.email}),
    metadata: meta,
    subscription_data: {metadata: meta, ...(opts.trialDays && opts.trialDays >= 1 ? {trial_period_days: Math.min(Math.floor(opts.trialDays), 90)} : {})},
    allow_promotion_codes: true,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (!session.url) throw new StripeError('Stripe did not return a checkout link.', 502);
  return session.url;
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripeCall<{url?: string}>('POST', '/billing_portal/sessions', {customer: customerId, return_url: returnUrl});
  if (!session.url) throw new StripeError('Stripe did not return a portal link.', 502);
  return session.url;
}

// ---------- webhook signature ----------

/** Verifies the `Stripe-Signature` header: HMAC-SHA256 of `${t}.${rawBody}` and a fresh timestamp. */
export function verifyStripeWebhook(rawBody: Buffer | undefined, header: string | undefined, toleranceSec = 300): boolean {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret || !rawBody || !header) return false;
  let t = '';
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);
  }
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return sigs.some((s) => {
    try {
      const got = Buffer.from(s, 'hex');
      return got.length === expected.length && crypto.timingSafeEqual(got, expected);
    } catch {
      return false;
    }
  });
}

// ---------- subscription sync ----------

interface StripeSubscription {
  id: string;
  status: string;
  customer: string | {id: string};
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  default_payment_method?: {card?: {last4?: string}} | string | null;
  items?: {data?: {current_period_end?: number; price?: {id?: string}}[]};
}

export async function fetchSubscription(id: string): Promise<StripeSubscription> {
  return stripeCall<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`, {expand: ['default_payment_method']});
}

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];

/** Copies Stripe's view of the subscription onto the workspace. Idempotent: safe to run for any event, in any order. */
export function applySubscription(ws: TenantWorkspace, sub: StripeSubscription): void {
  const b = ws.billing;
  const item = sub.items?.data?.[0];
  const mapped = planForPrice(item?.price?.id ?? '');
  const live = ['trialing', 'active', 'past_due'].includes(sub.status);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

  ws.secrets = {
    ...(ws.secrets ?? {}),
    ...(customerId ? {stripeCustomerId: customerId} : {}),
    // An old subscription ending must not clear a newer one that was already recorded.
    ...(live || !ws.secrets?.stripeSubscriptionId || ws.secrets.stripeSubscriptionId === sub.id ? {stripeSubscriptionId: sub.id} : {}),
  };
  if (!live && ws.secrets.stripeSubscriptionId !== sub.id) return;

  b.subscriptionStatus = SUBSCRIPTION_STATUSES.includes(sub.status) ? (sub.status as NonNullable<typeof b.subscriptionStatus>) : 'incomplete';
  b.cancelAtPeriodEnd = sub.cancel_at_period_end === true;
  if (sub.status === 'past_due') b.pastDueSinceISO = b.pastDueSinceISO ?? new Date().toISOString();
  else if (sub.status === 'active' || sub.status === 'trialing') delete b.pastDueSinceISO;
  if (mapped && live) {
    b.plan = mapped.plan;
    b.billingCycle = mapped.cycle;
    b.minutesIncluded = PLAN_MINUTES[mapped.plan];
  }
  const periodEnd = sub.current_period_end ?? item?.current_period_end;
  if (periodEnd) b.currentPeriodEndISO = new Date(periodEnd * 1000).toISOString();
  if (periodEnd && live) {
    const when = new Date(periodEnd * 1000).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
    b.nextInvoiceDate = sub.cancel_at_period_end ? `${when} (cancels)` : when;
  } else if (!live) {
    b.nextInvoiceDate = 'No active subscription';
  }
  const pm = typeof sub.default_payment_method === 'object' ? sub.default_payment_method : null;
  if (pm?.card?.last4) b.paymentMethodLast4 = pm.card.last4;
}

export interface StripeInvoice {
  id: string;
  amount_paid?: number;
  created?: number;
  subscription?: string | null;
  parent?: {subscription_details?: {subscription?: string}} | null;
}

export const invoiceSubscriptionId = (inv: StripeInvoice): string =>
  (typeof inv.subscription === 'string' ? inv.subscription : '') || inv.parent?.subscription_details?.subscription || '';

export function recordPaidInvoice(ws: TenantWorkspace, inv: StripeInvoice): void {
  const b = ws.billing;
  if (b.invoices.some((i) => i.id === inv.id)) return;
  b.invoices.unshift({
    id: inv.id,
    date: new Date((inv.created ?? Date.now() / 1000) * 1000).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}),
    plan: b.plan,
    amount: Math.round(inv.amount_paid ?? 0) / 100,
    status: 'Paid',
  });
  if (b.invoices.length > 36) b.invoices.length = 36;
  // A new paid invoice starts a new billing period: included minutes refresh.
  b.minutesUsed = 0;
  delete b.usageNotice;
}

/**
 * Reports extra AI minutes to a Stripe Billing Meter (optional). Set STRIPE_OVERAGE_METER_EVENT to the meter's event name
 * and add a metered Price on that meter to the subscription. `identifier` makes retries safe (one event per call).
 * Returns false when metering is not set up; never throws.
 */
export async function reportOverageMinutes(customerId: string, minutes: number, identifier: string): Promise<boolean> {
  const eventName = env('STRIPE_OVERAGE_METER_EVENT');
  if (!eventName || !customerId || !(minutes > 0)) return false;
  try {
    await stripeCall('POST', '/billing/meter_events', {
      event_name: eventName,
      identifier,
      payload: {stripe_customer_id: customerId, value: Math.round(minutes)},
    });
    return true;
  } catch (e) {
    console.error('[stripe] overage report failed:', e instanceof Error ? e.message : e);
    return false;
  }
}
