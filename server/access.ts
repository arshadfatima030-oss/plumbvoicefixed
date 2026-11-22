import type {BillingData, TenantWorkspace} from '../src/types/plumbvoice.ts';
import {stripeConfigured} from './stripe.ts';

/**
 * Who may use the paid features (AI website chat, test agent, AI tool calls, booking page, review texts).
 * Rules apply ONLY when Stripe is configured; without Stripe everything stays open (nobody is charged).
 *
 *   no subscription   -> free trial for TRIAL_DAYS from the day the workspace was created
 *   active / trialing -> allowed (cancel-at-period-end shows as "canceling" but still works)
 *   past_due          -> allowed for PAST_DUE_GRACE_DAYS after the first failed payment, then blocked
 *   canceled          -> allowed until the paid period ends, then blocked
 *   unpaid / paused / incomplete_expired -> blocked
 *
 * A blocked business can still sign in, read its data and open Billing. Nothing is deleted.
 */
export const TRIAL_DAYS = 14;
export const PAST_DUE_GRACE_DAYS = 7;
const DAY = 86_400_000;

export type AccessInfo = NonNullable<BillingData['access']>;

export function accessFor(ws: TenantWorkspace, now = Date.now()): AccessInfo {
  if (!stripeConfigured()) return {state: 'free', allowed: true};
  const b = ws.billing;
  const sub = b.subscriptionStatus;

  if (sub === 'active' || sub === 'trialing') {
    return {state: b.cancelAtPeriodEnd ? 'canceling' : 'active', allowed: true, endsAtISO: b.currentPeriodEndISO};
  }
  if (sub === 'past_due') {
    const since = Date.parse(b.pastDueSinceISO ?? '');
    const graceEnd = (Number.isFinite(since) ? since : now) + PAST_DUE_GRACE_DAYS * DAY;
    return now < graceEnd
      ? {state: 'grace', allowed: true, endsAtISO: new Date(graceEnd).toISOString()}
      : {state: 'blocked', allowed: false, endsAtISO: new Date(graceEnd).toISOString()};
  }
  if (sub === 'canceled') {
    const end = Date.parse(b.currentPeriodEndISO ?? '');
    if (Number.isFinite(end) && now < end) return {state: 'canceling', allowed: true, endsAtISO: b.currentPeriodEndISO};
    return {state: 'blocked', allowed: false};
  }
  if (sub === 'unpaid' || sub === 'paused' || sub === 'incomplete_expired') return {state: 'blocked', allowed: false};

  // No paid subscription yet: free trial.
  const start = Date.parse(b.trialStartedAtISO ?? '');
  if (!Number.isFinite(start)) return {state: 'trial', allowed: true, trialDaysLeft: TRIAL_DAYS}; // older workspace, trial starts when first seen
  const end = start + TRIAL_DAYS * DAY;
  const left = Math.max(0, Math.ceil((end - now) / DAY));
  return now < end
    ? {state: 'trial', allowed: true, trialDaysLeft: left, endsAtISO: new Date(end).toISOString()}
    : {state: 'blocked', allowed: false, trialDaysLeft: 0, endsAtISO: new Date(end).toISOString()};
}

/**
 * Which plan unlocks which paid extra. Starter keeps the core receptionist (calls, leads, transcripts, alerts, website chat).
 * Like the billing rules above, this is enforced ONLY when Stripe is configured; a free trial can try everything.
 */
export type PlanFeature = 'calendar' | 'missedCallText' | 'ringFirst' | 'webhooks' | 'knowledgeImport' | 'smsActions' | 'multiLocation';
const PLAN_RANK: Record<string, number> = {Starter: 0, Professional: 1, Business: 2};
const FEATURE_MIN_PLAN: Record<PlanFeature, 'Starter' | 'Professional' | 'Business'> = {
  calendar: 'Professional',
  missedCallText: 'Professional',
  ringFirst: 'Professional',
  webhooks: 'Professional',
  knowledgeImport: 'Professional',
  smsActions: 'Professional',
  multiLocation: 'Business',
};
export const FEATURE_LABEL: Record<PlanFeature, string> = {
  calendar: 'Google Calendar booking',
  missedCallText: 'Missed-call text-back',
  ringFirst: 'Ring the owner first',
  webhooks: 'Webhooks',
  knowledgeImport: 'Website knowledge import',
  smsActions: 'Texting links during a call',
  multiLocation: 'Multi-location routing',
};

export function planAllows(ws: TenantWorkspace, feature: PlanFeature, now = Date.now()): boolean {
  if (!stripeConfigured()) return true;
  const info = accessFor(ws, now);
  if (!info.allowed) return false;
  if (info.state === 'trial') return true;
  return (PLAN_RANK[ws.billing.plan] ?? 0) >= PLAN_RANK[FEATURE_MIN_PLAN[feature]];
}

/** For the UI: which gated features this business can use now, and the plan each one needs. */
export function featureAccess(ws: TenantWorkspace, now = Date.now()): Record<PlanFeature, {allowed: boolean; minPlan: string}> {
  const out = {} as Record<PlanFeature, {allowed: boolean; minPlan: string}>;
  for (const f of Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]) out[f] = {allowed: planAllows(ws, f, now), minPlan: FEATURE_MIN_PLAN[f]};
  return out;
}

export const upgradeMessage = (feature: PlanFeature): string =>
  `${FEATURE_LABEL[feature]} is included in the ${FEATURE_MIN_PLAN[feature]} plan and above. Upgrade under Billing to use it.`;

export const BLOCKED_MESSAGE = 'This business’s PlumbVoice subscription is inactive. The owner can reactivate it under Billing.';
