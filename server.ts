import 'dotenv/config';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type {Request, Response, NextFunction} from 'express';
import {store, newId, LIMITS, teamHasRoom, OVERAGE_RATE, PLAN_MINUTES, STEP_UP_WINDOW_MS, DEVICE_TTL_MS, UserFacingError, emailIdentityKey, normalizeEmail} from './server/store.ts';
import {geminiConfigured, matchEmergency, runAgent} from './server/agent.ts';
import {buildEmergencyAlert, detectLanguage, routeLocation, tagCall, withinTextingHours} from './server/rules.ts';
import {deliverWebhook, emitEvent, getWebhookLog, WEBHOOK_EVENTS} from './server/outbound.ts';
import {accessFor, BLOCKED_MESSAGE, featureAccess, planAllows, upgradeMessage} from './server/access.ts';
import {reportOverageMinutes, applySubscription, createCheckoutSession, createPortalSession, fetchSubscription, invoiceSubscriptionId, recordPaidInvoice, StripeError, stripeConfigured, verifyStripeWebhook} from './server/stripe.ts';
import type {StripeInvoice} from './server/stripe.ts';
import {hmacHex, safeEqual, seal, secretsConfigured, unseal} from './server/secrets.ts';
import {previewWebsite} from './server/knowledge.ts';
import {csrfVerdict} from './server/csrf.ts';
import {productionConfigReport} from './server/prodChecks.ts';
import {chatBudget, chatLimits, prepareTurns} from './server/chatGuard.ts';
import {needsStepUp} from './server/stepUpPolicy.ts';
import {checkSmsConsent, consentErrorMessage, grantSmsConsent, isPurpose, restoreSmsConsent, revokeSmsConsent, STAFF_ATTESTED_SOURCES} from './server/consent.ts';
import {openRecording, parseRecordingUrl, safeRange} from './server/recordings.ts';
import {technicianView, techAppointmentView, techLeadView} from './server/techView.ts';
import {accessTokenFrom, buildAuthUrl, eventIdFor, exchangeCode, gcalConfigured, isSlotFree, listFreeWindows, upsertEvent, parseWindow, WINDOW_FORMAT_ERROR} from './server/gcal.ts';
import {createDispatcher, enqueue as enqueueOutbox} from './server/outbox.ts';
import type {Outcome} from './server/outbox.ts';
import {fetchConversationTranscript, parseTelnyxCallEvent, sendTelnyxSms, telnyxConfigured, telnyxSmsConfigured, toE164, verifyTelnyxWebhook, texmlSignatureOk, texmlSignatureRequired} from './server/telnyx.ts';
import type {ChatTurn} from './server/agent.ts';
import {actionCodeEmail, leadAlertEmail, loginCodeEmail, mailConfigured, resetEmail, sendMail, verificationEmail} from './server/mailer.ts';
import {clientIp, createRateLimiter} from './server/rateLimit.ts';
import {installProcessGuards, makeAsyncSafe, sleep} from './server/safe.ts';
import {bool, buildPatch, csvCell, isEmail, isRecord, isValidDateISO, num, oneOf, pick, str} from './server/validate.ts';
import type {
  AppointmentItem,
  CallItem,
  FollowUpItem,
  IntegrationStatusItem,
  LeadItem,
  LocationItem,
  OutboxEntry,
  PlanTier,
  QuoteItem,
  ReminderItem,
  SmsConsentPurpose,
  TeamMember,
  TenantWorkspace,
  UserSession,
  VoiceAgentConfig,
} from './src/types/plumbvoice.ts';

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

const TRADES = ['Plumbing', 'Electrical'] as const;
const URGENCIES = ['Emergency', 'Urgent', 'Normal'] as const;
const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Appointment Scheduled', 'In Progress', 'Converted', 'Lost'] as const;
const APPT_STATUSES = ['Scheduled', 'En Route', 'On Site', 'Completed'] as const;
const FOLLOWUP_STATUSES = ['Pending', 'Sent', 'Replied', 'Opted Out'] as const;
const PLANS = ['Starter', 'Professional', 'Business'] as const;
const ROLES = ['Owner', 'Dispatcher', 'Technician', 'Viewer'] as const;
const STAFF_ROLES = ['Dispatcher', 'Technician', 'Viewer'] as const;
const SESSION_COOKIE = 'pv_session';
const DEVICE_COOKIE = 'pv_device';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

type Role = UserSession['role'];
interface Ctx {
  session: UserSession;
  workspace: TenantWorkspace;
  token: string;
  /** Workspace version read from shared storage; used for compare-and-set on save. */
  version: number;
  /** Serialized workspace at load time, to detect whether a request changed anything. */
  snapshot: string;
  /** This browser was saved with "Remember this device". */
  deviceTrusted: boolean;
  /** Untrusted-device sessions may do sensitive actions until this time (ms) after a code check. */
  stepUpUntil: number;
  /** Idempotency-Key header (same value on every retry of one user action). Used to derive stable record ids. */
  idemKey?: string;
}

// ---------- request helpers ----------

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  const result: Record<string, string> = {};
  if (!raw) return result;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    try {
      result[k] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return result;
}

function getToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  return bearer || parseCookies(req)[SESSION_COOKIE];
}

/** The session and workspace are loaded from shared storage once per request by middleware. */
function getAuthenticatedContext(res: Response): Ctx | null {
  return (res.locals.ctx as Ctx | undefined) ?? null;
}

/** The team member row that belongs to a signed-in user (matched by e-mail). */
function memberFor(ws: TenantWorkspace, email: string) {
  const e = email.trim().toLowerCase();
  return ws.team.find((m) => m.email.trim().toLowerCase() === e);
}

/** True when a technician may see/touch this appointment (it is assigned to them). */
const techOwnsAppointment = (ws: TenantWorkspace, email: string, a: AppointmentItem) => {
  const me = memberFor(ws, email);
  return Boolean(me && a.assignedMemberId === me.id);
};

/** True when a technician may see/touch this lead (assigned to them, or linked to one of their appointments). */
const techOwnsLead = (ws: TenantWorkspace, email: string, l: LeadItem) => {
  const me = memberFor(ws, email);
  if (!me) return false;
  return l.assignedMemberId === me.id || ws.appointments.some((a) => a.assignedMemberId === me.id && a.linkedLeadId === l.id);
};

/** What the signed-in user may see. Technicians get only their own jobs, in the allowlisted shape from server/techView.ts. */
function viewFor(ws: TenantWorkspace, session: {role: string; email: string}) {
  const full = store.view(ws);
  if (session.role !== 'Technician') return full;
  return technicianView(full, memberFor(ws, session.email), (l) => techOwnsLead(ws, session.email, l), (a) => techOwnsAppointment(ws, session.email, a));
}

function requireAuth(_req: Request, res: Response, roles?: readonly Role[]): Ctx | null {
  const ctx = getAuthenticatedContext(res);
  if (!ctx) {
    res.status(401).json({error: 'Authentication required. Please sign in.'});
    return null;
  }
  if (roles && !roles.includes(ctx.session.role)) {
    res.status(403).json({error: 'Your role does not have permission to do this.'});
    return null;
  }
  return ctx;
}

function requireVerified(ctx: Ctx, res: Response): boolean {
  if (ctx.session.emailVerified) return true;
  res.status(403).json({error: 'Please verify your email address before doing this.'});
  return false;
}

const cookieBase = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  // Override with COOKIE_SECURE=false only for plain-http local testing (e.g. Safari on localhost).
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  path: '/',
});

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {...cookieBase(), maxAge: COOKIE_MAX_AGE});
}

function setDeviceCookie(res: Response, token: string) {
  res.cookie(DEVICE_COOKIE, token, {...cookieBase(), maxAge: DEVICE_TTL_MS});
}

const getDeviceToken = (req: Request) => parseCookies(req)[DEVICE_COOKIE];
const userAgent = (req: Request) => String(req.headers['user-agent'] || 'Unknown device').slice(0, 200);

/**
 * Emailed codes are only demanded when mail can actually be delivered (otherwise nobody could
 * ever sign in). Set LOGIN_CODES=always in development to test the flow with codes printed to the console.
 */
/**
 * Without a mail provider nobody can click a verification link, so accounts are auto-verified. That is only acceptable
 * while developing: in production it would let anyone sign up with an e-mail address they do not own. So in production
 * signup is refused until mail is configured, unless ALLOW_UNVERIFIED_SIGNUP=true is set on purpose (e.g. a short test).
 */
const autoVerifyAllowed = () => !isProd || process.env.ALLOW_UNVERIFIED_SIGNUP === 'true';
const codesRequired = () => mailConfigured() || process.env.LOGIN_CODES === 'always';

/** Sensitive changes on a device that wasn't saved need a recent emailed code. */
const ACTION_LABELS: Record<string, string> = {
  'POST /api/leads': 'Created a lead',
  'PATCH /api/leads/:id': 'Updated a lead',
  'DELETE /api/leads/:id': 'Deleted a lead',
  'POST /api/leads/merge': 'Merged duplicate leads',
  'POST /api/leads/:id/review-request': 'Sent a review request',
  'POST /api/leads/:id/quotes': 'Created a quote',
  'POST /api/leads/:id/reminders': 'Scheduled a reminder',
  'POST /api/leads/:id/sms-consent': 'Recorded text-message consent',
  'DELETE /api/leads/:id/sms-consent': 'Recorded withdrawal of text-message consent',
  'POST /api/reminders/:id/cancel': 'Cancelled a reminder',
  'POST /api/quotes/:id/send': 'Texted a quote link',
  'POST /api/quotes/:id/void': 'Voided a quote',
  'PATCH /api/billing': 'Changed plan (local)',
  'POST /api/billing/checkout': 'Started plan checkout',
  'POST /api/billing/portal': 'Opened billing portal',
  'PATCH /api/extras': 'Changed integration / automation settings',
  'PATCH /api/settings': 'Changed business settings',
  'PATCH /api/voice-agent': 'Changed AI agent settings',
  'POST /api/team': 'Invited a team member',
  'PATCH /api/team/:id': 'Changed a team member',
  'DELETE /api/team/:id': 'Removed a team member',
  'POST /api/appointments': 'Created an appointment',
  'PATCH /api/appointments/:id': 'Updated an appointment',
  'DELETE /api/appointments/:id': 'Deleted an appointment',
  'POST /api/auth/change-password': 'Changed password',
  'POST /api/auth/forget-devices': 'Forgot all saved devices',
};
function describeAction(method: string, route: string): string {
  return ACTION_LABELS[`${method} ${route}`] ?? `${method} ${route.replace(/^\/api\//, '')}`;
}

function requireStepUp(ctx: Ctx, res: Response): boolean {
  if (!codesRequired() || ctx.deviceTrusted || ctx.stepUpUntil > Date.now()) return true;
  res.status(403).json({error: 'Confirm this change with the code we email you.', stepUpRequired: true});
  return false;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function baseUrl(req: Request): string | null {
  const configured = process.env.APP_URL;
  if (configured && configured !== 'MY_APP_URL') {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through */
    }
  }
  // Never trust the Host header for links in production emails (host-header injection).
  return isProd ? null : `${req.protocol}://${req.get('host')}`;
}

async function sendVerification(req: Request, user: {id: string; name: string; email: string}) {
  const base = baseUrl(req);
  if (!base) {
    console.error('[mail] APP_URL must be set in production to send verification links.');
    return false;
  }
  const url = `${base}/verify-email?token=${await store.createToken(user.id, 'verify')}`;
  const mail = verificationEmail(user.name, url);
  return sendMail({...mail, to: user.email});
}

function getIntegrationStatuses(): IntegrationStatusItem[] {
  const hasGemini = geminiConfigured();
  const hasStripe = stripeConfigured();
  const hasEmail = mailConfigured();
  const hasGoogleCal = Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID);

  return [
    {
      id: 'gemini-voice-ai',
      name: 'Gemini AI Voice & Triage Engine',
      category: 'Voice AI',
      connected: hasGemini,
      summary: hasGemini
        ? 'Live server-side intake and structured lead extraction. If the model is unavailable the Test Agent falls back to a rule-based intake flow.'
        : 'No API key set — the Test Agent is running on the built-in rule-based intake flow. Add GEMINI_API_KEY for AI-generated replies.',
      envRequired: ['GEMINI_API_KEY', 'GEMINI_MODEL (optional)'],
      setupInstructions:
        'Set GEMINI_API_KEY (and optionally GEMINI_MODEL, comma-separated, e.g. gemini-2.5-flash) in the server environment. Used server-side only.',
    },
    {
      id: 'system-number-engine',
      name: 'Telephony / System Number',
      category: 'Telephony',
      connected: telnyxConfigured(),
      summary: telnyxConfigured()
        ? 'Telnyx webhook keys are set. Real calls appear only after your Telnyx AI Assistant points at /api/webhooks/telnyx/<organizationId> and a test call completes.'
        : 'Simulation mode: System Numbers are placeholders and test calls are simulated. Set TELNYX_API_KEY and TELNYX_PUBLIC_KEY to accept real calls.',
      envRequired: ['TELNYX_API_KEY', 'TELNYX_PUBLIC_KEY'],
      setupInstructions:
        'Create a Telnyx AI Assistant, enable post-call webhooks, and set its webhook URL to https://YOUR_APP/api/webhooks/telnyx/<organizationId>. See TELNYX_SETUP.md.',
    },
    {
      id: 'system-sms-alerts',
      name: 'Dispatch SMS & Missed-Call Text-Back',
      category: 'Messaging',
      connected: telnyxSmsConfigured(),
      summary: telnyxSmsConfigured()
        ? 'Emergency SMS alerts and missed-call text-back are sent through Telnyx (needs a live test). Honours opt-outs, 8am–9pm hours and one text per caller per day.'
        : 'No SMS provider is connected, so no text messages are sent yet.',
      envRequired: ['TELNYX_API_KEY', 'TELNYX_SMS_FROM'],
      setupInstructions:
        'Connect an SMS provider and honour STOP opt-outs and each follow-up’s consent flag before sending.',
    },
    {
      id: 'email-alerts',
      name: 'Transactional Email',
      category: 'Messaging',
      connected: hasEmail,
      summary: hasEmail
        ? 'Verification, password-reset and new-device emails are sent through SendGrid.'
        : 'Set SENDGRID_API_KEY and MAIL_FROM so account emails are delivered (otherwise they are only logged in development).',
      envRequired: ['SENDGRID_API_KEY', 'MAIL_FROM'],
      setupInstructions:
        'Verify your sender domain in SendGrid (SPF/DKIM) and use an address on it for MAIL_FROM so mail does not land in spam.',
    },
    {
      id: 'google-calendar',
      name: 'Google Calendar Dispatch Sync',
      category: 'Calendar',
      connected: false,
      summary: gcalConfigured()
        ? 'Server is ready for Google OAuth. Each workspace connects its own calendar (Owner: GET /api/integrations/google/start). Not verified end-to-end yet.'
        : 'Not connected. Set the Google OAuth env vars and SECRETS_KEY to enable calendar booking.',
      envRequired: ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'APP_URL', 'SECRETS_KEY'],
      setupInstructions: 'Create a Google OAuth web client with redirect URI APP_URL/api/integrations/google/callback and enable the Google Calendar API.',
    },
    {
      id: 'stripe-billing',
      name: 'Stripe Subscription Billing',
      category: 'Billing',
      connected: hasStripe,
      summary: hasStripe
        ? 'Stripe Checkout and the customer billing portal are live. Plans, status and invoices are updated only by verified Stripe webhooks. Run one test-mode checkout before going live.'
        : 'Not connected. Plan changes are recorded locally and nobody is charged. Set the Stripe keys and Price IDs below to take real payments.',
      envRequired: [
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_PRICE_STARTER',
        'STRIPE_PRICE_PROFESSIONAL',
        'STRIPE_PRICE_BUSINESS',
        'STRIPE_PRICE_*_ANNUAL (optional)',
      ],
      setupInstructions:
        'Create 3 recurring Prices in Stripe (Starter $69, Professional $169, Business $299), add a webhook endpoint https://YOUR_APP/api/webhooks/stripe (events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed) and turn on the Customer Portal. See FEATURES_SETUP.md.',
    },
  ];
}

const nowIso = () => new Date().toISOString();

// Production only (the Vite dev server needs inline scripts / websockets). Keep in sync with scripts/vercel-build.mjs.
// The app loads no third-party scripts; Google Fonts is the only external resource. Inline styles come from React style props.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

// ---------- app ----------

async function initStorageWithRetry() {
  // The database may still be starting (e.g. all containers booting together), so retry before giving up.
  // On Vercel the function is killed at maxDuration (30s), so retry within a ~20s budget instead of ~70s.
  const attempts = process.env.VERCEL ? 4 : 10;
  const maxWait = process.env.VERCEL ? 3000 : 10_000;
  for (let attempt = 1; ; attempt++) {
    try {
      await store.init();
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      const wait = Math.min(attempt * 1000, maxWait);
      console.error(
        `[storage] init failed (attempt ${attempt}/${attempts}): ${err instanceof Error ? err.message : err}. Retrying in ${wait / 1000}s…`
      );
      await sleep(wait);
    }
  }
}

export async function startServer(): Promise<express.Express | undefined> {
  await initStorageWithRetry();
  const app = express();
  makeAsyncSafe(app); // async route failures become 500 responses instead of crashing the process
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.use(
    express.json({
      limit: '256kb',
      // Signed provider webhooks need the exact bytes to verify the signature.
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/webhooks/')) (req as Request & {rawBody?: Buffer}).rawBody = Buffer.from(buf);
      },
    })
  );

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000');
      res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    }
    next();
  });

  // Block cross-site state-changing requests (strict: see server/csrf.ts).
  app.use('/api', (req, res, next) => {
    const verdict = csrfVerdict({
      method: req.method,
      path: req.path,
      origin: req.headers.origin,
      referer: req.headers.referer,
      secFetchSite: typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : undefined,
      host: req.get('host'),
      appUrl: process.env.APP_URL,
      production: isProd,
    });
    if (!verdict.ok) {
      console.warn(`[csrf] blocked ${req.method} /api${req.path}: ${verdict.reason}`);
      res.status(403).json({error: 'Cross-origin request blocked.'});
      return;
    }
    next();
  });

  // Load the session + workspace from shared storage (any server can serve any request), and
  // for write requests save the workspace back with an optimistic-lock check before replying.
  app.use('/api', async (req, res, next) => {
    try {
      const token = getToken(req);
      const loaded = token ? await store.loadContext(token, getDeviceToken(req)) : null;
      if (!token || !loaded) {
        next();
        return;
      }
      const ctx: Ctx = {
        session: loaded.session,
        workspace: loaded.workspace,
        token,
        version: loaded.version,
        snapshot: JSON.stringify(loaded.workspace),
        deviceTrusted: loaded.deviceTrusted,
        stepUpUntil: loaded.stepUpUntil,
        idemKey: ((v) => (v && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : undefined))(req.header('idempotency-key')),
      };
      res.locals.ctx = ctx;

      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        // Audit trail: who changed what. Only successful changes; never the request body (no personal data).
        res.on('finish', () => {
          if (res.statusCode >= 400) return;
          const route = String(req.route?.path ?? req.path);
          if (route.includes('/auth/logout') || route.includes('/step-up/')) return;
          const paramId = (req.params as Record<string, unknown> | undefined)?.id;
          void store
            .addAuditLog(ctx.workspace.organizationId, {
              id: newId('aud'),
              at: new Date().toISOString(),
              userEmail: ctx.session.email,
              role: ctx.session.role,
              action: describeAction(req.method, route),
              target: typeof paramId === 'string' ? paramId.slice(0, 40) : undefined,
            })
            .catch(() => {});
        });
        const sendJson = res.json.bind(res);
        res.json = ((body?: unknown) => {
          store.enforceLimits(ctx.workspace);
          if (res.statusCode >= 400 || JSON.stringify(ctx.workspace) === ctx.snapshot) {
            return sendJson(body);
          }
          store
            .saveWorkspace(ctx.workspace.organizationId, ctx.workspace, ctx.version)
            .then(async (newVersion) => {
              if (res.headersSent) return; // client disconnected or another path already replied
              if (newVersion === null) {
                // Another server/session saved first; nothing was written, so a retry is safe.
                res.status(409);
                sendJson({error: 'Your workspace changed in another session. Retrying…', retryable: true});
              } else {
                ctx.version = newVersion;
                ctx.snapshot = JSON.stringify(ctx.workspace);
                // Committed: now (and only now) perform queued texts / webhooks / calendar writes. Waiting briefly keeps this
                // working on serverless hosts that freeze the process after the reply; anything slower is picked up by the sweeper.
                if (ctx.workspace.outbox?.some((e) => e.status === 'pending')) {
                  await Promise.race([dispatchOutbox(ctx.workspace.organizationId), sleep(4000)]).catch(() => {});
                }
                if (res.headersSent) return;
                sendJson(body);
              }
            })
            .catch((err) => {
              console.error('[server] workspace save failed:', err);
              if (res.headersSent) return;
              res.status(500);
              sendJson({error: 'Could not save your changes. Please try again.'});
            });
          return res;
        }) as typeof res.json;
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  // Central step-up gate: the policy table in server/stepUpPolicy.ts decides, so no sensitive route can be forgotten.
  // Roles that may not use a route at all fall through and get that route's own "no permission" answer.
  app.use('/api', (req, res, next) => {
    const ctx = getAuthenticatedContext(res);
    if (ctx && (ctx.session.role === 'Owner' || ctx.session.role === 'Dispatcher') && needsStepUp(req.method, req.path, req.body)) {
      if (!requireVerified(ctx, res) || !requireStepUp(ctx, res)) return;
    }
    next();
  });

  // Rate-limit keys must (1) use the same identity the account lookup uses, so alias spellings of one
  // mailbox (a.b@, ab+1@, trailing space) share a bucket, and (2) never contain raw secrets, because
  // keys are persisted in the rate_limits table.
  const keyHash = (v: string) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);
  const emailBucket = (raw: unknown) =>
    typeof raw === 'string' ? emailIdentityKey(normalizeEmail(raw.slice(0, 254))) : '';
  const secretBucket = (raw: unknown) => (typeof raw === 'string' && raw ? keyHash(raw) : '');

  /** Sends the error's message only if it is safe for users; otherwise logs it and returns a generic answer. */
  const authFail = (res: Response, err: unknown, clientStatus: number, fallback: string) => {
    if (err instanceof UserFacingError) {
      res.status(clientStatus).json({error: err.message});
      return;
    }
    console.error('[auth] unexpected error:', err);
    res.status(500).json({error: fallback});
  };

  const authLimiter = createRateLimiter({
    name: 'auth',
    windowMs: 15 * 60_000,
    max: 10,
    key: (req) => `${clientIp(req)}|${emailBucket(req.body?.email)}`,
    message: 'Too many attempts. Please wait a few minutes and try again.',
  });
  // Forgot-password: per mailbox, plus a per-IP cap so one IP cannot mail-bomb many different addresses.
  const mailLimiter = createRateLimiter({
    name: 'mail-email',
    windowMs: 60 * 60_000,
    max: 5,
    key: (req) => `${clientIp(req)}|${emailBucket(req.body?.email)}`,
    message: 'Too many requests. Please try again later.',
  });
  const mailIpLimiter = createRateLimiter({
    name: 'mail-ip',
    windowMs: 60 * 60_000,
    max: 20,
    key: clientIp,
    message: 'Too many requests. Please try again later.',
  });
  // Resend-verification is authenticated and ignores the body, so it is limited per session only.
  const sessionMailLimiter = createRateLimiter({
    name: 'mail-session',
    windowMs: 60 * 60_000,
    max: 5,
    key: (req) => secretBucket(getToken(req)) || clientIp(req),
    message: 'Too many requests. Please try again later.',
  });
  const codeLimiter = createRateLimiter({
    name: 'code',
    windowMs: 15 * 60_000,
    max: 15,
    key: (req) => `${clientIp(req)}|${secretBucket(req.body?.challengeId) || secretBucket(getToken(req))}`,
    message: 'Too many code attempts. Please wait a few minutes.',
  });
  const stepUpMailLimiter = createRateLimiter({
    name: 'stepup-mail',
    windowMs: 60 * 60_000,
    max: 8,
    key: (req) => secretBucket(getToken(req)) || clientIp(req),
    message: 'Too many codes requested. Please try again later.',
  });
  const contactLimiter = createRateLimiter({
    name: 'contact',windowMs: 60 * 60_000, max: 5, key: clientIp});
  const agentLimiter = createRateLimiter({
    name: 'agent-min',
    windowMs: 60_000,
    max: 20,
    key: (req) => secretBucket(getToken(req)) || clientIp(req),
    message: 'Slow down — too many test-agent turns per minute.',
  });

  // Writes that can push real records out of the capped call/lead lists, and the paid AI endpoint.
  const orgOf = (req: Request) => (req.res?.locals.ctx as Ctx | undefined)?.workspace?.organizationId;
  const testCallLimiter = createRateLimiter({
    name: 'test-call',
    windowMs: 60 * 60_000,
    max: 20,
    key: (req) => orgOf(req) || secretBucket(getToken(req)) || clientIp(req),
    message: 'Too many test calls. Please try again later.',
  });
  const leadCreateLimiter = createRateLimiter({
    name: 'lead-create',
    windowMs: 60 * 60_000,
    max: 60,
    key: (req) => orgOf(req) || secretBucket(getToken(req)) || clientIp(req),
    message: 'Too many leads created. Please try again later.',
  });
  // Texts sent from a signed-in session cost real money and reach real people: cap them per business.
  const smsSendLimiter = createRateLimiter({
    name: 'sms-send',
    windowMs: 60 * 60_000,
    max: 30,
    key: (req) => orgOf(req) || clientIp(req),
    message: 'Too many texts sent from this account in the last hour. Please wait before sending more.',
  });
  // Safety net for runaway scripts or a hijacked session: every signed-in user, all writes combined.
  const writeLimiter = createRateLimiter({
    name: 'user-writes',
    windowMs: 60_000,
    max: 240,
    key: (req) => (req.res?.locals.ctx as Ctx | undefined)?.session.userId || clientIp(req),
    message: 'Too many changes too quickly. Please slow down.',
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !res.locals.ctx) return next();
    return writeLimiter(req, res, next);
  });

  // Per organization and per IP, so opening many accounts does not multiply the allowance.
  const agentOrgLimiter = createRateLimiter({
    name: 'agent-org',
    windowMs: 60 * 60_000,
    max: 300,
    key: (req) => orgOf(req) || secretBucket(getToken(req)) || clientIp(req),
    message: 'Test-agent hourly limit reached. Please try again later.',
  });
  const agentIpLimiter = createRateLimiter({
    name: 'agent-ip',
    windowMs: 60 * 60_000,
    max: 120,
    key: clientIp,
    message: 'Too many test-agent requests from this network. Please try again later.',
  });

  // Additional limiters for endpoints that were previously uncapped.
  // Email-verification tokens: stop token guessing from one network.
  const verifyEmailLimiter = createRateLimiter({
    name: 'verify-email',
    windowMs: 15 * 60_000,
    max: 20,
    key: clientIp,
    message: 'Too many attempts. Please wait a few minutes and try again.',
  });
  // Calls that hit Stripe, Google or an outbound webhook URL on behalf of a signed-in business.
  const externalCallLimiter = createRateLimiter({
    name: 'external-call',
    windowMs: 60 * 60_000,
    max: 30,
    key: (req) => orgOf(req) || secretBucket(getToken(req)) || clientIp(req),
    message: 'Too many requests. Please try again later.',
  });
  // Heavy reads (full exports) and invitation emails.
  const exportLimiter = createRateLimiter({
    name: 'export',
    windowMs: 60 * 60_000,
    max: 20,
    key: (req) => orgOf(req) || secretBucket(getToken(req)) || clientIp(req),
    message: 'Too many exports. Please try again later.',
  });
  const teamInviteLimiter = createRateLimiter({
    name: 'team-invite',
    windowMs: 60 * 60_000,
    max: 20,
    key: (req) => orgOf(req) || secretBucket(getToken(req)) || clientIp(req),
    message: 'Too many team invitations. Please try again later.',
  });
  // Provider callbacks (signature / secret-URL protected). Deliberately generous: provider IPs are shared by many
  // customers. This only blunts floods of unsigned junk before the signature check does its work.
  const webhookIpLimiter = createRateLimiter({
    name: 'webhook-ip',
    windowMs: 60_000,
    max: 600,
    key: clientIp,
    message: 'Too many requests.',
  });
  // Public read endpoints used by the chat widget and booking page.
  const publicReadLimiter = createRateLimiter({
    name: 'public-read',
    windowMs: 60_000,
    max: 120,
    key: clientIp,
    message: 'Too many requests. Please try again shortly.',
  });

  // ----- SEO -----
  const publicPaths = [
    '/', '/how-it-works', '/features', '/plumbing-answering-service', '/electrician-answering-service',
    '/pricing', '/about', '/contact', '/blog',
    '/cities/houston-tx', '/cities/austin-tx', '/cities/phoenix-az', '/cities/denver-co',
  ];
  app.get('/robots.txt', (req, res) => {
    const base = baseUrl(req) || `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(
      ['User-agent: *', 'Allow: /', 'Disallow: /app/', 'Disallow: /api/', 'Disallow: /book/', 'Disallow: /quote/', `Sitemap: ${base}/sitemap.xml`].join('\n')
    );
  });
  app.get('/sitemap.xml', (req, res) => {
    const base = baseUrl(req) || `${req.protocol}://${req.get('host')}`;
    const urls = publicPaths
      .map((p) => `  <url><loc>${base}${p}</loc><changefreq>weekly</changefreq><priority>${p === '/' ? '1.0' : '0.8'}</priority></url>`)
      .join('\n');
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
    );
  });

  // ----- health, integrations, contact -----
  // Liveness: the process is up. `instance` shows which server answered (handy behind a load balancer).
  app.get('/api/health', (_req, res) => {
    res.json({ok: true, service: 'PlumbVoice AI', instance: os.hostname(), storage: store.backend, mail: mailConfigured(), timestamp: nowIso()});
  });

  // Readiness: the shared database is reachable. Load balancers should use this to route traffic.
  app.get('/api/ready', async (_req, res) => {
    try {
      await store.ping();
      res.json({ready: true, instance: os.hostname()});
    } catch {
      res.status(503).json({ready: false});
    }
  });

  app.get('/api/integrations/status', (req, res) => {
    if (!requireAuth(req, res, ['Owner', 'Dispatcher', 'Viewer'])) return;
    res.json({integrations: getIntegrationStatuses()});
  });

  app.post('/api/public/contact', contactLimiter, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const name = str(body.name, 100);
    const email = str(body.email, 254).toLowerCase();
    const message = str(body.message, 3000);
    if (!name || !isEmail(email) || !message) {
      res.status(400).json({error: 'A name, valid email, and message are required.'});
      return;
    }
    await store.addContact({
      id: newId('contact'),
      name,
      email,
      company: str(body.company, 120),
      trade: str(body.trade, 60) || 'Plumbing & Electrical',
      message,
      createdAt: nowIso(),
    });
    res.status(201).json({ok: true});
  });

  // ----- auth -----
  app.get('/api/auth/me', (_req, res) => {
    const ctx = getAuthenticatedContext(res);
    res.json({user: ctx ? ctx.session : null});
  });

  app.post('/api/auth/signup', authLimiter, async (req, res) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const name = str(body.name, 100);
      const email = str(body.email, 254).toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      const businessName = str(body.businessName, 120);
      if (!name || !businessName || !isEmail(email)) {
        res.status(400).json({error: 'Name, a valid email, and business name are required.'});
        return;
      }
      if (password.length < 8 || password.length > 128) {
        res.status(400).json({error: 'Password must be 8–128 characters.'});
        return;
      }
      if (password.toLowerCase() === email) {
        res.status(400).json({error: 'Password must not be your email address.'});
        return;
      }
      if (isProd && !mailConfigured() && !autoVerifyAllowed()) {
        res.status(503).json({error: 'Sign-up is temporarily unavailable: e-mail delivery is not set up on this server yet.'});
        return;
      }
      const {token, user, stored} = await store.registerAccount({
        name,
        email,
        password,
        businessName,
        businessPhone: str(body.businessPhone, 30),
        plan: oneOf(body.plan, PLANS) ?? 'Starter',
        // Without a mail provider nobody could ever click a verification link, so don't lock features behind it.
        emailVerified: !mailConfigured(),
      });
      setSessionCookie(res, token);
      // The person just chose a password on this browser, so remember it as a trusted device.
      setDeviceCookie(res, await store.trustDevice(stored.id, getDeviceToken(req), userAgent(req)));
      const emailSent = user.emailVerified ? false : await sendVerification(req, stored);
      res.status(201).json({user: {...user, deviceTrusted: true}, verificationEmailSent: emailSent});
    } catch (err) {
      authFail(res, err, 400, 'Signup failed.');
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const email = str(body.email, 254);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      res.status(400).json({error: 'Email and password are required.'});
      return;
    }
    try {
      const user = await store.verifyCredentials(email, password);
      const trusted = store.isDeviceTrusted(user, getDeviceToken(req));

      if (trusted || !codesRequired()) {
        setSessionCookie(res, await store.startSession(user.id));
        res.json({user: await store.sessionFor(user, trusted)});
        return;
      }

      // Unsaved device: password alone is not enough, email a one-time code.
      const {id, code} = await store.issueCode(user.id, 'login', body.rememberDevice === true);
      const sent = await sendMail({...loginCodeEmail(user.name, code, userAgent(req)), to: user.email});
      if (!sent && mailConfigured()) {
        res.status(503).json({error: 'We could not email your sign-in code. Please try again in a moment.'});
        return;
      }
      res.json({codeRequired: true, challengeId: id, emailHint: maskEmail(user.email)});
    } catch (err) {
      authFail(res, err, 401, 'Login failed.');
    }
  });

  app.post('/api/auth/login/verify', codeLimiter, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const challengeId = str(body.challengeId, 64);
    const code = str(body.code, 12);
    if (!/^[0-9a-f]{32}$/.test(challengeId) || !/^\d{6}$/.test(code)) {
      res.status(400).json({error: 'Enter the 6-digit code from your email.'});
      return;
    }
    try {
      const {userId, remember} = await store.checkCode(challengeId, code, 'login');
      const user = await store.getUserById(userId);
      if (!user) throw new UserFacingError('That code is incorrect or has expired.');
      if (!user.emailVerified) {
        await store.markVerified(user.id); // receiving the code proves they own the inbox
        user.emailVerified = true;
      }
      const token = await store.startSession(user.id, {stepUpUntil: Date.now() + STEP_UP_WINDOW_MS});
      let trusted = false;
      if (remember || body.rememberDevice === true) {
        setDeviceCookie(res, await store.trustDevice(user.id, getDeviceToken(req), userAgent(req)));
        trusted = true;
      }
      setSessionCookie(res, token);
      res.json({user: await store.sessionFor(user, trusted)});
    } catch (err) {
      authFail(res, err, 400, 'Could not verify the code.');
    }
  });

  // Confirm a sensitive change on a device that wasn't saved.
  app.post('/api/auth/step-up/start', stepUpMailLimiter, async (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    if (!codesRequired() || ctx.deviceTrusted) {
      res.json({ok: true, notRequired: true});
      return;
    }
    const user = await store.getUserById(ctx.session.userId);
    if (!user) {
      res.status(401).json({error: 'Authentication required. Please sign in.'});
      return;
    }
    const {id, code} = await store.issueCode(user.id, 'action');
    const sent = await sendMail({...actionCodeEmail(user.name, code), to: user.email});
    if (!sent && mailConfigured()) {
      res.status(503).json({error: 'We could not email your confirmation code. Please try again.'});
      return;
    }
    res.json({ok: true, challengeId: id, emailHint: maskEmail(user.email)});
  });

  app.post('/api/auth/step-up/verify', codeLimiter, async (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    const challengeId = str(req.body?.challengeId, 64);
    const code = str(req.body?.code, 12);
    if (!/^[0-9a-f]{32}$/.test(challengeId) || !/^\d{6}$/.test(code)) {
      res.status(400).json({error: 'Enter the 6-digit code from your email.'});
      return;
    }
    try {
      await store.checkCode(challengeId, code, 'action', ctx.session.userId);
      await store.markStepUp(ctx.token);
      if (req.body?.rememberDevice === true) {
        setDeviceCookie(res, await store.trustDevice(ctx.session.userId, getDeviceToken(req), userAgent(req)));
      }
      res.json({ok: true});
    } catch (err) {
      authFail(res, err, 400, 'Could not verify the code.');
    }
  });

  app.post('/api/auth/forget-devices', async (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    await store.forgetDevices(ctx.session.userId, ctx.token);
    res.clearCookie(DEVICE_COOKIE, {path: '/'});
    res.json({ok: true});
  });

  app.post('/api/auth/logout', async (req, res) => {
    await store.destroySession(getToken(req));
    res.clearCookie(SESSION_COOKIE, {path: '/'});
    res.json({ok: true});
  });

  app.post('/api/auth/verify-email', verifyEmailLimiter, async (req, res) => {
    const token = str(req.body?.token, 200);
    const user = token ? await store.consumeToken(token, 'verify') : null;
    if (!user) {
      res.status(400).json({error: 'This verification link is invalid or has expired.'});
      return;
    }
    await store.markVerified(user.id);
    res.json({ok: true});
  });

  app.post('/api/auth/resend-verification', sessionMailLimiter, async (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    if (ctx.session.emailVerified) {
      res.json({ok: true, alreadyVerified: true});
      return;
    }
    const user = await store.getUserById(ctx.session.userId);
    const sent = user ? await sendVerification(req, user) : false;
    res.json({ok: true, emailSent: sent});
  });

  app.post('/api/auth/forgot-password', mailIpLimiter, mailLimiter, async (req, res) => {
    const email = str(req.body?.email, 254);
    const user = email ? await store.getUserByEmail(email) : undefined;
    const base = baseUrl(req);
    if (user && base) {
      const url = `${base}/reset-password?token=${await store.createToken(user.id, 'reset')}`;
      void sendMail({...resetEmail(user.name, url), to: user.email});
    }
    // Same answer whether or not the account exists.
    res.json({ok: true});
  });

  app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
    const token = str(req.body?.token, 200);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({error: 'Password must be 8–128 characters.'});
      return;
    }
    const user = token ? await store.consumeToken(token, 'reset') : null;
    if (!user) {
      res.status(400).json({error: 'This reset link is invalid or has expired.'});
      return;
    }
    await store.resetPassword(user.id, password);
    res.json({ok: true});
  });

  app.post('/api/auth/change-password', authLimiter, async (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx || !requireStepUp(ctx, res)) return;
    const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const next = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (next.length < 8 || next.length > 128) {
      res.status(400).json({error: 'New password must be 8–128 characters.'});
      return;
    }
    try {
      await store.changePassword(ctx.session.userId, current, next, ctx.token);
      res.json({ok: true});
    } catch (err) {
      authFail(res, err, 400, 'Could not change password.');
    }
  });

  app.patch('/api/auth/profile', async (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    const name = str(req.body?.name, 100);
    if (!name) {
      res.status(400).json({error: 'Name is required.'});
      return;
    }
    res.json({user: await store.updateName(ctx.session.userId, name)});
  });

  // ----- workspace & dashboard -----
  app.get('/api/workspace', (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    if (!ctx.workspace.billing.trialStartedAtISO) {
      // Older workspace: its free trial starts the first time it is opened after this update.
      const iso = nowIso();
      ctx.workspace.billing.trialStartedAtISO = iso;
      void store.mutateWorkspace(ctx.workspace.organizationId, (w) => {
        w.billing.trialStartedAtISO = w.billing.trialStartedAtISO ?? iso;
      }).catch(() => {});
    }
    res.json({user: ctx.session, workspace: viewFor(ctx.workspace, ctx.session), integrations: ctx.session.role === 'Technician' ? [] : getIntegrationStatuses()});
  });

  app.get('/api/dashboard', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Viewer']);
    if (!ctx) return;
    const range = oneOf(req.query.range, ['today', '7d', '30d'] as const) ?? '7d';
    const maxOffset = range === 'today' ? 0 : range === '7d' ? 6 : 29;
    const ws = store.view(ctx.workspace);
    // Test Agent and simulated calls never count towards real statistics.
    const calls = ws.calls.filter((c) => !c.isTest && c.dayOffset <= maxOffset);
    const leads = ws.leads.filter((l) => !l.isTest && l.dayOffset <= maxOffset);
    const totalCalls = calls.length;
    const callsWithLead = calls.filter((c) => c.linkedLeadId).length;
    res.json({
      range,
      stats: {
        totalCalls,
        aiAnswered: calls.filter((c) => c.answeredBy === 'AI' && c.status !== 'Missed').length,
        missedCalls: calls.filter((c) => c.status === 'Missed').length,
        totalLeads: leads.length,
        qualifiedLeads: leads.filter((l) => ['Qualified', 'Appointment Scheduled', 'In Progress', 'Converted'].includes(l.status)).length,
        conversionRate: totalCalls > 0 ? Math.round((callsWithLead / totalCalls) * 100) : 0,
      },
      calls,
      leads,
    });
  });

  // ----- calls -----
  app.get('/api/calls', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Viewer']);
    if (!ctx) return;
    const tag = str(req.query.tag, 30);
    const calls = store.view(ctx.workspace).calls;
    res.json({calls: tag ? calls.filter((c) => c.tags?.includes(tag)) : calls});
  });

  app.get('/api/calls/:id', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Viewer']);
    if (!ctx) return;
    const ws = store.view(ctx.workspace);
    const call = ws.calls.find((c) => c.id === req.params.id);
    if (!call) {
      res.status(404).json({error: 'Call record not found'});
      return;
    }
    res.json({call, linkedLead: call.linkedLeadId ? ws.leads.find((l) => l.id === call.linkedLeadId) : undefined});
  });

  // ----- leads -----
  const memberIdOk = (ws: TenantWorkspace) => (v: unknown) =>
    typeof v === 'string' && ws.team.some((m) => m.id === v) ? v : undefined;

  const leadPatch = (body: unknown, ws: TenantWorkspace) =>
    buildPatch<LeadItem>(body, {
      name: (v) => str(v, 100) || undefined,
      phone: (v) => str(v, 30) || undefined,
      email: (v) => (typeof v === 'string' ? str(v, 254) : undefined),
      trade: (v) => oneOf(v, TRADES),
      serviceType: (v) => str(v, 140) || undefined,
      problemDescription: (v) => (typeof v === 'string' ? str(v, 2000) : undefined),
      zip: (v) => (typeof v === 'string' ? str(v, 10) : undefined),
      fullAddress: (v) => (typeof v === 'string' ? str(v, 250) : undefined),
      urgency: (v) => oneOf(v, URGENCIES),
      preferredAppointment: (v) => (typeof v === 'string' ? str(v, 100) : undefined),
      status: (v) => oneOf(v, LEAD_STATUSES),
      estimatedValue: (v) => num(v, 0, 10_000_000),
      assignedMemberId: memberIdOk(ws),
      internalNotes: (v) => (typeof v === 'string' ? str(v, 4000) : undefined),
    });

  app.get('/api/leads/export/csv', exportLimiter, (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const headers = ['ID', 'Name', 'Phone', 'Email', 'Trade', 'Service Type', 'Urgency', 'Status', 'ZIP', 'Address', 'Preferred Appointment', 'Estimated Value', 'Created At'];
    const ws = store.view(ctx.workspace);
    const rows = ws.leads.map((l) =>
      [l.id, l.name, l.phone, l.email, l.trade, l.serviceType, l.urgency, l.status, l.zip, l.fullAddress, l.preferredAppointment, l.estimatedValue, l.createdAtISO || l.createdAt]
        .map(csvCell)
        .join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="plumbvoice-leads.csv"');
    res.send('\uFEFF' + [headers.map(csvCell).join(','), ...rows].join('\r\n'));
  });

  app.get('/api/leads', (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    res.json({leads: viewFor(ctx.workspace, ctx.session).leads});
  });

  app.post('/api/leads', leadCreateLimiter, (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const ws = ctx.workspace;
    const body = isRecord(req.body) ? req.body : {};
    const patch = leadPatch(body, ws);
    if (!patch.name || !patch.phone || !patch.serviceType) {
      res.status(400).json({error: 'Lead name, phone, and service type are required.'});
      return;
    }
    const linkedCall = typeof body.linkedCallId === 'string' ? ws.calls.find((c) => c.id === body.linkedCallId) : undefined;
    const leadId = idemId(ctx, 'lead', `${ws.organizationId}-l`);
    const prior = ws.leads.find((l) => l.id === leadId); // the first attempt was saved but its reply got lost: answer again, create nothing
    if (prior) {
      res.status(200).json({lead: prior});
      return;
    }
    const lead: LeadItem = {
      id: leadId,
      organizationId: ws.organizationId,
      name: patch.name,
      phone: patch.phone,
      email: patch.email ?? '',
      trade: patch.trade ?? 'Plumbing',
      serviceType: patch.serviceType,
      problemDescription: patch.problemDescription || patch.serviceType,
      zip: patch.zip ?? '',
      fullAddress: patch.fullAddress ?? '',
      urgency: patch.urgency ?? 'Normal',
      preferredAppointment: patch.preferredAppointment || 'Next Available',
      leadSource: linkedCall ? 'AI Phone Receptionist' : 'Manual Entry',
      callDurationSec: linkedCall?.durationSec ?? 0,
      linkedCallId: linkedCall?.id,
      createdAt: 'Just now',
      createdAtISO: nowIso(),
      dayOffset: 0,
      status: patch.status ?? 'New',
      estimatedValue: patch.estimatedValue ?? 450,
      assignedMemberId: patch.assignedMemberId,
      internalNotes: patch.internalNotes ?? '',
    };
    if (linkedCall) linkedCall.linkedLeadId = lead.id;
    ws.leads.unshift(lead);
    queueWebhook(ws, 'lead_created', {id: lead.id, name: lead.name, phone: lead.phone, trade: lead.trade, urgency: lead.urgency, serviceType: lead.serviceType, source: lead.leadSource}, lead.id);
    res.status(201).json({lead});
  });

  app.patch('/api/leads/:id', async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Technician']);
    if (!ctx) return;
    const lead = ctx.workspace.leads.find((l) => l.id === req.params.id);
    if (!lead) {
      res.status(404).json({error: 'Lead not found'});
      return;
    }
    let patch = leadPatch(req.body, ctx.workspace);
    if (ctx.session.role === 'Technician') {
      if (!techOwnsLead(ctx.workspace, ctx.session.email, lead)) {
        res.status(403).json({error: 'This job is not assigned to you.'});
        return;
      }
      // Technicians may only progress status and add notes.
      patch = pick(patch, ['status', 'internalNotes']);
    }
    const wasConverted = lead.status === 'Converted';
    Object.assign(lead, patch);
    if (!wasConverted && lead.status === 'Converted') await afterLeadConverted(ctx.workspace, lead);
    res.json({lead: ctx.session.role === 'Technician' ? techLeadView(lead) : lead});
  });

  // ----- SMS consent ledger (captured before any text is sent; see server/consent.ts) -----
  const consentView = (ws: TenantWorkspace, phone: string) => {
    const rec = (ws.extras?.smsConsents ?? []).find((r) => r.phone === phone);
    const optedOut = (ws.extras?.smsOptOut ?? []).includes(phone);
    return {
      phone,
      optedOut,
      record: rec ? {source: rec.source, purposes: rec.purposes, capturedAtISO: rec.capturedAtISO, evidence: rec.evidence ?? '', revokedAtISO: rec.revokedAtISO ?? ''} : null,
      allowed: Object.fromEntries((['service', 'review_request', 'maintenance_reminder'] as const).map((k) => [k, checkSmsConsent(ws, phone, k).ok])),
    };
  };

  app.get('/api/leads/:id/sms-consent', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const lead = ctx.workspace.leads.find((l) => l.id === req.params.id);
    const phone = lead ? toE164(lead.phone) : '';
    if (!lead || !phone) {
      res.status(404).json({error: 'Lead not found or has no valid mobile number.'});
      return;
    }
    res.json({consent: consentView(ctx.workspace, phone)});
  });

  // Staff attest that the customer agreed (verbally or on a signed form). The note is required so there is something to point to later.
  app.post('/api/leads/:id/sms-consent', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const ws = ctx.workspace;
    const lead = ws.leads.find((l) => l.id === req.params.id);
    const phone = lead ? toE164(lead.phone) : '';
    if (!lead || !phone) {
      res.status(404).json({error: 'Lead not found or has no valid mobile number.'});
      return;
    }
    const b = isRecord(req.body) ? req.body : {};
    const purposes = Array.isArray(b.purposes) ? b.purposes.filter(isPurpose) : [];
    const source = oneOf(b.source, STAFF_ATTESTED_SOURCES);
    const note = str(b.note, 200);
    if (!purposes.length || !source || note.length < 3) {
      res.status(400).json({error: 'Choose what the customer agreed to, how they agreed, and add a short note (who, when, how).'});
      return;
    }
    if ((ws.extras?.smsOptOut ?? []).includes(phone)) {
      res.status(400).json({error: 'This number replied STOP. Only the customer can opt back in by texting START.'});
      return;
    }
    grantSmsConsent(ws, {phone, purposes, source, evidence: note, capturedBy: ctx.session.userId ?? ctx.session.role, nowISO: nowIso()});
    res.status(201).json({consent: consentView(ws, phone)});
  });

  app.delete('/api/leads/:id/sms-consent', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const lead = ctx.workspace.leads.find((l) => l.id === req.params.id);
    const phone = lead ? toE164(lead.phone) : '';
    if (!lead || !phone) {
      res.status(404).json({error: 'Lead not found or has no valid mobile number.'});
      return;
    }
    revokeSmsConsent(ctx.workspace, phone, nowIso());
    res.json({consent: consentView(ctx.workspace, phone)});
  });

  app.post('/api/leads/:id/review-request', smsSendLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'reminders')) {
      res.status(402).json({error: upgradeMessage('reminders'), code: 'plan_required'});
      return;
    }
    const lead = ctx.workspace.leads.find((l) => l.id === req.params.id);
    if (!lead) {
      res.status(404).json({error: 'Lead not found'});
      return;
    }
    const r = await sendReviewRequest(ctx.workspace, lead);
    if (!r.ok) {
      res.status(400).json({error: r.error});
      return;
    }
    res.json({lead});
  });

  app.delete('/api/leads/:id', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const ws = ctx.workspace;
    const before = ws.leads.length;
    ws.leads = ws.leads.filter((l) => l.id !== req.params.id);
    if (ws.leads.length === before) {
      res.status(404).json({error: 'Lead not found'});
      return;
    }
    for (const c of ws.calls) if (c.linkedLeadId === req.params.id) c.linkedLeadId = undefined;
    for (const a of ws.appointments) if (a.linkedLeadId === req.params.id) a.linkedLeadId = undefined;
    ws.followUps = ws.followUps.filter((f) => f.leadId !== req.params.id);
    res.json({ok: true});
  });

  // ----- appointments -----
  const apptRules = (ws: TenantWorkspace) => ({
    title: (v: unknown) => str(v, 140) || undefined,
    customerName: (v: unknown) => str(v, 100) || undefined,
    customerPhone: (v: unknown) => (typeof v === 'string' ? str(v, 30) : undefined),
    address: (v: unknown) => (typeof v === 'string' ? str(v, 250) : undefined),
    trade: (v: unknown) => oneOf(v, TRADES),
    urgency: (v: unknown) => oneOf(v, URGENCIES),
    dateISO: (v: unknown) => (typeof v === 'string' && isValidDateISO(v) ? v : undefined),
    timeWindow: (v: unknown) => str(v, 40) || undefined,
    assignedMemberId: memberIdOk(ws),
    status: (v: unknown) => oneOf(v, APPT_STATUSES),
    estimatedValue: (v: unknown) => num(v, 0, 10_000_000),
  });

  app.post('/api/appointments', async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const ws = ctx.workspace;
    const p = buildPatch<AppointmentItem>(req.body, apptRules(ws));
    if (!p.title || !p.customerName || !p.dateISO) {
      res.status(400).json({error: 'Title, customer name, and a valid date (YYYY-MM-DD) are required.'});
      return;
    }
    const linkedLeadId =
      typeof req.body?.linkedLeadId === 'string' && ws.leads.some((l) => l.id === req.body.linkedLeadId)
        ? req.body.linkedLeadId
        : undefined;
    const apptId = idemId(ctx, 'appointment', `${ws.organizationId}-a`);
    const priorAppt = ws.appointments.find((a) => a.id === apptId);
    if (priorAppt) {
      res.status(200).json({appointment: priorAppt});
      return;
    }
    const appt: AppointmentItem = {
      id: apptId,
      organizationId: ws.organizationId,
      title: p.title,
      customerName: p.customerName,
      customerPhone: p.customerPhone ?? '',
      address: p.address ?? '',
      trade: p.trade ?? 'Plumbing',
      urgency: p.urgency ?? 'Normal',
      dateISO: p.dateISO,
      timeWindow: p.timeWindow ?? '10:00 AM – 12:00 PM',
      assignedMemberId: p.assignedMemberId ?? ws.team.find((m) => m.role === 'Technician')?.id ?? ws.team[0]?.id ?? '',
      status: 'Scheduled',
      estimatedValue: p.estimatedValue ?? 450,
      googleSynced: false,
      linkedLeadId,
    };
    // Real Google Calendar sync (only when the owner connected it): confirm availability first, then create the event.
    const gToken = planAllows(ws, 'calendar') ? await googleToken(ws) : null;
    if (gToken) {
      const calId = ws.extras?.googleCalendar?.calendarId || 'primary';
      if (!parseWindow(appt.timeWindow)) {
        // Free text cannot be checked against the calendar, so it is refused instead of being booked unchecked.
        res.status(400).json({error: WINDOW_FORMAT_ERROR});
        return;
      }
      try {
        if (!(await isSlotFree(gToken, calId, appt.dateISO, appt.timeWindow, ws.settings.timezone))) {
          res.status(409).json({error: 'That time is already busy on the connected Google Calendar. Pick another window.'});
          return;
        }
        // The availability check above is a read and stays inline. The calendar WRITE is queued with the save (event id = hash of appt id).
        appt.googleEventId = eventIdFor(appt.id);
        enqueueOutbox(ws, {id: newId(`${ws.organizationId}-o`), dedupeKey: `gcal:${appt.id}:create`, kind: 'gcal', payload: {appointmentId: appt.id}, after: {kind: 'appointment', id: appt.id}, nowISO: nowIso()});
      } catch (e) {
        console.error('[gcal] could not check calendar:', e instanceof Error ? e.message : e);
        // Booking still succeeds; the appointment stays marked as not synced.
      }
    }
    ws.appointments.unshift(appt);
    queueWebhook(ws, 'appointment_booked', {id: appt.id, title: appt.title, customerName: appt.customerName, customerPhone: appt.customerPhone, address: appt.address, dateISO: appt.dateISO, timeWindow: appt.timeWindow, googleSynced: false}, appt.id);
    res.status(201).json({appointment: appt});
  });

  app.patch('/api/appointments/:id', async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Technician']);
    if (!ctx) return;
    const appt = ctx.workspace.appointments.find((a) => a.id === req.params.id);
    if (!appt) {
      res.status(404).json({error: 'Appointment not found'});
      return;
    }
    let p = buildPatch<AppointmentItem>(req.body, apptRules(ctx.workspace));
    if (ctx.session.role === 'Technician') {
      if (!techOwnsAppointment(ctx.workspace, ctx.session.email, appt)) {
        res.status(403).json({error: 'This job is not assigned to you.'});
        return;
      }
      p = pick(p, ['status']);
    }
    if (p.timeWindow && appt.googleEventId && !parseWindow(p.timeWindow)) {
      res.status(400).json({error: WINDOW_FORMAT_ERROR});
      return;
    }
    const wasDone = appt.status === 'Completed';
    const moved = (p.dateISO && p.dateISO !== appt.dateISO) || (p.timeWindow && p.timeWindow !== appt.timeWindow);
    Object.assign(appt, p);
    if (!wasDone && appt.status === 'Completed') {
      // Finished job: close the linked lead (this also triggers the optional automatic review request) and tell the owner.
      const lead = appt.linkedLeadId ? ctx.workspace.leads.find((l) => l.id === appt.linkedLeadId) : undefined;
      if (lead && lead.status !== 'Converted') {
        lead.status = 'Converted';
        await afterLeadConverted(ctx.workspace, lead);
      }
      const who = ctx.workspace.team.find((m) => m.id === appt.assignedMemberId)?.name || ctx.session.name;
      store.notify(ctx.workspace, {
        type: 'System',
        title: `Job completed — ${appt.customerName}`,
        body: `${appt.title} was marked done by ${who}.`,
        targetPath: lead ? `/app/leads/${lead.id}` : '/app/appointments',
      });
    }
    if (moved && appt.googleEventId) {
      appt.googleSynced = false; // flips back to true when the queued calendar update succeeds
      enqueueOutbox(ctx.workspace, {
        id: newId(`${ctx.workspace.organizationId}-o`), dedupeKey: `gcal:${appt.id}:${ctx.idemKey ?? nowIso()}`, kind: 'gcal',
        payload: {appointmentId: appt.id}, after: {kind: 'appointment', id: appt.id}, nowISO: nowIso(),
      });
    }
    res.json({appointment: ctx.session.role === 'Technician' ? techAppointmentView(appt) : appt});
  });

  // ----- follow-ups (TCPA: never mark Sent without consent) -----
  app.patch('/api/followups/:id', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const fu = ctx.workspace.followUps.find((f) => f.id === req.params.id);
    if (!fu) {
      res.status(404).json({error: 'Follow-up not found'});
      return;
    }
    const p = buildPatch<FollowUpItem>(req.body, {
      status: (v) => oneOf(v, FOLLOWUP_STATUSES),
      messagePreview: (v) => str(v, 1000) || undefined,
    });
    if (p.status === 'Sent' && !fu.consentOptIn) {
      res.status(400).json({error: 'This contact has not opted in to SMS, so the message cannot be sent.'});
      return;
    }
    if (fu.status === 'Opted Out' && p.status && p.status !== 'Opted Out') {
      res.status(400).json({error: 'This contact opted out and cannot be messaged again.'});
      return;
    }
    Object.assign(fu, p);
    if (fu.status === 'Opted Out') fu.consentOptIn = false;
    res.json({followUp: fu});
  });

  // ----- notifications -----
  app.patch('/api/notifications/:id/read', (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    const n = ctx.workspace.notifications.find((item) => item.id === req.params.id);
    if (n) n.read = true;
    res.json({ok: true});
  });

  app.post('/api/notifications/read-all', (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    for (const n of ctx.workspace.notifications) n.read = true;
    res.json({ok: true});
  });

  // ----- voice agent, phone, settings (Owner only) -----
  const zipList = (v: unknown) =>
    Array.isArray(v) ? v.map((z) => str(z, 10)).filter((z) => /^\d{5}$/.test(z)).slice(0, 100) : undefined;

  app.patch('/api/agent-config', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const p = buildPatch<VoiceAgentConfig>(req.body, {
      agentName: (v) => str(v, 40) || undefined,
      businessName: (v) => str(v, 120) || undefined,
      businessType: (v) => oneOf(v, ['Plumbing', 'Electrical', 'Plumbing & Electrical'] as const),
      businessPhone: (v) => (typeof v === 'string' ? str(v, 30) : undefined),
      address: (v) => (typeof v === 'string' ? str(v, 250) : undefined),
      serviceAreas: zipList,
      workingHoursSummary: (v) => (typeof v === 'string' ? str(v, 200) : undefined),
      afterHoursAnswering: bool,
      ringTimeoutSec: (v) => num(v, 5, 60),
      greetingMessage: (v) => str(v, 600) || undefined,
      voiceId: (v) => oneOf(v, ['us-warm-female', 'us-calm-male', 'us-crisp-female', 'us-authoritative-male'] as const),
      speakingSpeed: (v) => num(v, 0.5, 2),
      accent: (v) => oneOf(v, ['American English (Neutral)', 'American English (Southern)', 'American English (Midwest)'] as const),
      emergencyInstructions: (v) => (typeof v === 'string' ? str(v, 3000) : undefined),
      aiKnowledgeNotes: (v) => (typeof v === 'string' ? str(v, 4000) : undefined),
    });
    ctx.workspace.voiceAgent = {...ctx.workspace.voiceAgent, ...p};
    res.json({voiceAgent: ctx.workspace.voiceAgent});
  });

  app.patch('/api/phone-setup', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    // systemNumber / forwardingVerified are server-controlled and cannot be set by the client.
    const p = buildPatch<TenantWorkspace['phoneSetup']>(req.body, {
      businessPhone: (v) => (typeof v === 'string' ? str(v, 30) : undefined),
      ringTimeoutSec: (v) => num(v, 5, 60),
      afterHoursForwarding: bool,
      carrier: (v) => oneOf(v, ['AT&T', 'Verizon', 'T-Mobile', 'RingCentral', 'Grasshopper'] as const),
    });
    ctx.workspace.phoneSetup = {...ctx.workspace.phoneSetup, ...p};
    res.json({phoneSetup: ctx.workspace.phoneSetup});
  });

  app.post('/api/phone-setup/provision', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx || !requireVerified(ctx, res)) return;
    const numberType = req.body?.numberType === 'Toll-Free 888' ? 'Toll-Free 888' : 'Local DID';
    const areaCode = str(req.body?.areaCode, 3) || '512';
    if (numberType === 'Local DID' && !/^[2-9]\d{2}$/.test(areaCode)) {
      res.status(400).json({error: 'Enter a valid 3-digit US area code.'});
      return;
    }
    res.json({phoneSetup: store.provisionSystemNumber(ctx.workspace, areaCode, numberType)});
  });

  app.patch('/api/settings', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const cur = ctx.workspace.settings;
    const body = isRecord(req.body) ? req.body : {};
    const next = {...cur};

    Object.assign(
      next,
      buildPatch<typeof cur>(body, {
        businessName: (v) => str(v, 120) || undefined,
        licenseNumber: (v) => (typeof v === 'string' ? str(v, 80) : undefined),
        dispatchEmail: (v) => (typeof v === 'string' && isEmail(v.trim().toLowerCase()) ? v.trim().toLowerCase() : undefined),
        timezone: (v) => (typeof v === 'string' ? str(v, 60) || undefined : undefined),
        holidayAutoAfterHours: bool,
      })
    );

    if (Array.isArray(body.workingHours) && body.workingHours.length === 7) {
      const time = /^([01]\d|2[0-3]):[0-5]\d$/;
      const rows = body.workingHours.map((r: unknown, i: number) => {
        const row = isRecord(r) ? r : {};
        const open = typeof row.open === 'string' && time.test(row.open) ? row.open : cur.workingHours[i].open;
        const close = typeof row.close === 'string' && time.test(row.close) ? row.close : cur.workingHours[i].close;
        return {day: cur.workingHours[i].day, enabled: bool(row.enabled) ?? cur.workingHours[i].enabled, open, close};
      });
      next.workingHours = rows;
    }

    if (isRecord(body.emergencyRules)) {
      const r = body.emergencyRules;
      if (typeof r.escalateToPhone === 'string' && r.escalateToPhone.trim() && !toE164(str(r.escalateToPhone, 30))) {
        res.status(400).json({error: 'Enter a valid phone number for emergency alerts, for example +1 555 123 4567.'});
        return;
      }
      next.emergencyRules = {
        ...cur.emergencyRules,
        ...(Array.isArray(r.keywords)
          ? {keywords: r.keywords.map((k) => str(k, 60)).filter(Boolean).slice(0, 50)}
          : {}),
        ...(typeof r.escalateToPhone === 'string' ? {escalateToPhone: r.escalateToPhone.trim() ? toE164(str(r.escalateToPhone, 30)) : ''} : {}),
        ...(bool(r.requireSafeShutoffGuidance) !== undefined ? {requireSafeShutoffGuidance: r.requireSafeShutoffGuidance as boolean} : {}),
        ...(bool(r.smsNotifyOwnerImmediately) !== undefined ? {smsNotifyOwnerImmediately: r.smsNotifyOwnerImmediately as boolean} : {}),
      };
    }

    if (isRecord(body.notificationPreferences)) {
      const n = body.notificationPreferences;
      next.notificationPreferences = {
        ...cur.notificationPreferences,
        ...buildPatch<typeof cur.notificationPreferences>(n, {
          smsOnNewLead: bool,
          smsOnEmergency: bool,
          emailDailyDigest: bool,
          missedCallTextBackEnabled: bool,
          tcpaFooterText: (v) => str(v, 300) || undefined,
        }),
      };
    }

    ctx.workspace.settings = next;
    res.json({settings: next});
  });

  // ----- team -----
  app.post('/api/team', teamInviteLimiter, (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx || !requireVerified(ctx, res) || !requireStepUp(ctx, res)) return;
    const ws = ctx.workspace;
    const body = isRecord(req.body) ? req.body : {};
    const name = str(body.name, 100);
    const email = str(body.email, 254).toLowerCase();
    if (!name || !isEmail(email)) {
      res.status(400).json({error: 'A name and valid email are required.'});
      return;
    }
    if (ws.team.some((m) => m.email.toLowerCase() === email)) {
      res.status(409).json({error: 'A team member with this email already exists.'});
      return;
    }
    if (!teamHasRoom(ws)) {
      res.status(400).json({error: `The team is limited to ${LIMITS.team} people.`});
      return;
    }
    if ((oneOf(body.role, STAFF_ROLES) ?? 'Technician') === 'Technician' && !planAllows(ws, 'technicianApp')) {
      res.status(402).json({error: upgradeMessage('technicianApp'), code: 'plan_required'});
      return;
    }
    const member: TeamMember = {
      id: newId(`${ws.organizationId}-m`),
      organizationId: ws.organizationId,
      name,
      email,
      phone: str(body.phone, 30),
      role: oneOf(body.role, STAFF_ROLES) ?? 'Technician',
      tradeSpecialty: oneOf(body.tradeSpecialty, [...TRADES, 'Both'] as const) ?? 'Plumbing',
      truckCode: str(body.truckCode, 30) || 'Unassigned',
      status: 'Invited',
      onCall: false,
    };
    ws.team.push(member);
    res.status(201).json({member});
  });

  app.patch('/api/team/:id', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    if (isRecord(req.body) && 'role' in req.body && !requireStepUp(ctx, res)) return; // role changes are sensitive
    const member = ctx.workspace.team.find((m) => m.id === req.params.id);
    if (!member) {
      res.status(404).json({error: 'Team member not found'});
      return;
    }
    let p = buildPatch<TeamMember>(req.body, {
      name: (v) => str(v, 100) || undefined,
      phone: (v) => (typeof v === 'string' ? str(v, 30) : undefined),
      role: (v) => oneOf(v, STAFF_ROLES),
      tradeSpecialty: (v) => oneOf(v, [...TRADES, 'Both'] as const),
      truckCode: (v) => str(v, 30) || undefined,
      onCall: bool,
    });
    if (ctx.session.role !== 'Owner') p = pick(p, ['onCall']); // dispatchers: on-call rota only
    if (member.role === 'Owner') delete p.role; // the owner role is never reassigned
    Object.assign(member, p);
    res.json({member});
  });

  app.delete('/api/team/:id', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx || !requireStepUp(ctx, res)) return;
    const ws = ctx.workspace;
    const member = ws.team.find((m) => m.id === req.params.id);
    if (!member) {
      res.status(404).json({error: 'Team member not found'});
      return;
    }
    if (member.role === 'Owner') {
      res.status(400).json({error: 'The account owner cannot be removed.'});
      return;
    }
    ws.team = ws.team.filter((m) => m.id !== member.id);
    for (const l of ws.leads) if (l.assignedMemberId === member.id) l.assignedMemberId = undefined;
    for (const a of ws.appointments) if (a.assignedMemberId === member.id) a.assignedMemberId = ws.team[0]?.id ?? '';
    res.json({ok: true});
  });

  // ----- billing -----
  // With Stripe configured, a plan can only change through a paid Checkout / the Stripe portal, and the result
  // arrives via the signed webhook below. Without Stripe the old local-only behaviour is kept (nobody is charged).
  app.patch('/api/billing', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx || !requireStepUp(ctx, res)) return;
    if (stripeConfigured()) {
      res.status(409).json({error: 'Plans are changed through secure checkout. Use “Choose plan” or “Manage billing”.', useCheckout: true});
      return;
    }
    const b = ctx.workspace.billing;
    const plan = oneOf(req.body?.plan, PLANS) as PlanTier | undefined;
    const cycle = oneOf(req.body?.billingCycle, ['monthly', 'annual'] as const);
    if (plan) {
      b.plan = plan;
      b.minutesIncluded = PLAN_MINUTES[plan];
    }
    if (cycle) b.billingCycle = cycle;
    res.json({billing: {...b, paymentsEnabled: false}});
  });

  const stripeFail = (res: Response, e: unknown) => {
    if (e instanceof StripeError) {
      res.status(e.status >= 400 && e.status < 500 ? 400 : 502).json({error: e.status === 503 ? e.message : `Payment provider: ${e.message}`});
      return;
    }
    throw e;
  };
  const hasLiveSubscription = (ws: TenantWorkspace) =>
    Boolean(ws.secrets?.stripeSubscriptionId) && ['trialing', 'active', 'past_due'].includes(ws.billing.subscriptionStatus ?? '');

  app.post('/api/billing/checkout', externalCallLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx || !requireStepUp(ctx, res) || !requireVerified(ctx, res)) return;
    if (!stripeConfigured()) {
      res.status(503).json({error: 'Payments are not set up yet. Add the Stripe keys on the server first.'});
      return;
    }
    const plan = oneOf(req.body?.plan, PLANS) as PlanTier | undefined;
    const cycle = oneOf(req.body?.billingCycle, ['monthly', 'annual'] as const) ?? 'monthly';
    if (!plan) {
      res.status(400).json({error: 'Choose a plan.'});
      return;
    }
    if (hasLiveSubscription(ctx.workspace)) {
      res.status(409).json({error: 'You already have a subscription. Use “Manage billing” to change plan or card.', usePortal: true});
      return;
    }
    const base = baseUrl(req);
    if (!base) {
      res.status(500).json({error: 'APP_URL is not set on the server.'});
      return;
    }
    try {
      const url = await createCheckoutSession({
        orgId: ctx.workspace.organizationId,
        email: ctx.session.email,
        plan,
        cycle,
        customerId: ctx.workspace.secrets?.stripeCustomerId,
        trialDays: (() => {
          const a = accessFor(ctx.workspace);
          return a.state === 'trial' && ctx.workspace.billing.trialStartedAtISO ? a.trialDaysLeft : undefined;
        })(),
        successUrl: `${base}/app/billing?checkout=success`,
        cancelUrl: `${base}/app/billing?checkout=cancelled`,
      });
      res.json({url});
    } catch (e) {
      stripeFail(res, e);
    }
  });

  app.post('/api/billing/portal', externalCallLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx || !requireStepUp(ctx, res)) return;
    const customerId = ctx.workspace.secrets?.stripeCustomerId;
    if (!stripeConfigured() || !customerId) {
      res.status(400).json({error: 'No paid subscription yet. Choose a plan first.'});
      return;
    }
    const base = baseUrl(req);
    if (!base) {
      res.status(500).json({error: 'APP_URL is not set on the server.'});
      return;
    }
    try {
      res.json({url: await createPortalSession(customerId, `${base}/app/billing`)});
    } catch (e) {
      stripeFail(res, e);
    }
  });

  // Stripe -> us. The signature proves it came from Stripe; we then re-fetch the subscription from Stripe so a
  // replayed or out-of-order event can never set the plan to something stale.
  app.post('/api/webhooks/stripe', webhookIpLimiter, async (req, res) => {
    const raw = (req as Request & {rawBody?: Buffer}).rawBody;
    if (!verifyStripeWebhook(raw, req.header('stripe-signature'))) {
      res.status(401).json({error: 'Invalid webhook signature.'});
      return;
    }
    const ev = req.body as {id?: string; type?: string; data?: {object?: Record<string, unknown>}};
    const obj = ev?.data?.object ?? {};
    const type = String(ev?.type ?? '');
    const handled = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
    if (!ev?.id || !handled.includes(type)) {
      res.json({received: true, ignored: true});
      return;
    }
    try {
      const subId = type.startsWith('customer.subscription.')
        ? String(obj.id ?? '')
        : type === 'checkout.session.completed'
          ? String(obj.subscription ?? '')
          : invoiceSubscriptionId(obj as unknown as StripeInvoice);
      if (!subId) {
        res.json({received: true, ignored: true});
        return;
      }
      const sub = await fetchSubscription(subId);
      const orgId = str(sub.metadata?.organizationId, 120) || str(obj.client_reference_id, 120);
      if (!orgId) {
        res.json({received: true, ignored: true});
        return;
      }
      await store.mutateWorkspace(orgId, (ws) => {
        applySubscription(ws, sub);
        if (type === 'invoice.paid') recordPaidInvoice(ws, obj as unknown as StripeInvoice);
        if (type === 'invoice.payment_failed') {
          ws.billing.subscriptionStatus = ws.billing.subscriptionStatus === 'canceled' ? 'canceled' : 'past_due';
          if (ws.billing.subscriptionStatus === 'past_due') ws.billing.pastDueSinceISO = ws.billing.pastDueSinceISO ?? new Date().toISOString();
          store.notify(ws, {
            type: 'System',
            title: 'Payment failed',
            body: 'We could not charge your card. Update your payment method in Billing to keep your AI receptionist running.',
            targetPath: '/app/billing',
          });
        }
        if (type === 'checkout.session.completed') {
          store.notify(ws, {type: 'System', title: 'Subscription started', body: `You are now on the ${ws.billing.plan} plan. Thank you!`, targetPath: '/app/billing'});
        }
      });
      res.json({received: true});
    } catch (e) {
      // A 500 makes Stripe retry. Every step above is idempotent (state is re-fetched, invoices de-duplicated by id).
      console.error('[stripe] webhook processing failed:', e instanceof Error ? e.message : e);
      res.status(500).json({error: 'Could not process event.'});
    }
  });

  app.post('/api/onboarding/complete', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    ctx.workspace.onboardingCompleted = true;
    res.json({ok: true, onboardingCompleted: true});
  });

  // ----- voice agent test conversation (Gemini, with rule-based fallback) -----
  app.post('/api/agent/converse', agentLimiter, agentOrgLimiter, agentIpLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Viewer']);
    if (!ctx) return;
    if (!accessFor(ctx.workspace).allowed) {
      res.status(402).json({error: BLOCKED_MESSAGE, code: 'billing_required'});
      return;
    }
    const raw = req.body?.messages;
    if (!Array.isArray(raw) || raw.length > 60) {
      res.status(400).json({error: 'A conversation of up to 60 messages is required.'});
      return;
    }
    const turns: ChatTurn[] = raw
      .map((m: unknown) => (isRecord(m) ? m : {}))
      .map((m) => ({speaker: m.speaker === 'agent' ? ('agent' as const) : ('caller' as const), text: str(m.text, 1000)}))
      .filter((t) => t.text);
    const scenario = str(req.body?.scenario, 200).replace(/[\r\n]+/g, ' ');
    const wx = ctx.workspace.extras;
    const result = await runAgent(turns, scenario, ctx.workspace.voiceAgent, ctx.workspace.settings, {
      recordingNotice: wx?.recording?.consentNotice || undefined,
      locations: planAllows(ctx.workspace, 'multiLocation') ? wx?.locations?.map((l) => ({name: l.name, zips: l.zips, hours: l.hours})) : undefined,
    });
    res.json(result);
  });

  app.post('/api/agent/save-test-call', testCallLimiter, (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const ws = ctx.workspace;
    const rawT = req.body?.transcript;
    if (!Array.isArray(rawT) || rawT.length === 0 || rawT.length > 100) {
      res.status(400).json({error: 'A transcript of 1–100 turns is required.'});
      return;
    }
    const ex = isRecord(req.body?.extracted) ? req.body.extracted : {};
    const duration = Math.round(num(req.body?.durationSec, 1, 3600) ?? 60);
    const trade = oneOf(ex.trade, TRADES) ?? 'Plumbing';
    const urgency = ex.isEmergency === true || ex.urgency === 'Emergency' ? 'Emergency' : (oneOf(ex.urgency, URGENCIES) ?? 'Normal');
    const callId = newId(`${ws.organizationId}-c`);
    const leadId = newId(`${ws.organizationId}-l`);
    const iso = nowIso();
    const serviceType = str(ex.serviceType, 140) || 'General Service Inquiry';

    const lead: LeadItem = {
      id: leadId,
      organizationId: ws.organizationId,
      name: str(ex.name, 100) || 'Test Caller',
      phone: str(ex.phone, 30) || 'Not provided',
      email: '',
      trade,
      serviceType,
      problemDescription: str(ex.escalationReason, 300) || serviceType,
      zip: str(ex.zip, 10),
      fullAddress: str(ex.address, 250) || 'Address pending confirmation',
      urgency,
      preferredAppointment: str(ex.preferredTime, 100) || 'Next Available',
      leadSource: 'Web Demo',
      callDurationSec: duration,
      linkedCallId: callId,
      createdAt: 'Just now',
      createdAtISO: iso,
      dayOffset: 0,
      status: urgency === 'Emergency' ? 'Qualified' : 'New',
      estimatedValue: 0,
      internalNotes: 'Created from a Test Agent session.',
      isTest: true,
    };
    const call: CallItem = {
      id: callId,
      organizationId: ws.organizationId,
      callerName: lead.name,
      callerPhone: lead.phone,
      address: lead.fullAddress,
      zip: lead.zip,
      trade,
      serviceRequested: serviceType,
      answeredBy: 'AI',
      status: 'Answered',
      urgency,
      durationSec: duration,
      pickupRings: 1,
      estimatedValue: 0,
      createdAt: 'Just now',
      createdAtISO: iso,
      dayOffset: 0,
      hourOfDay: new Date().getHours(),
      aiSummary: lead.problemDescription,
      recordingAvailable: false,
      isTest: true,
      linkedLeadId: leadId,
      waveform: Array.from({length: 36}, () => 24 + crypto.randomInt(0, 64)),
      transcript: rawT.map((t: unknown, i: number) => {
        const r = isRecord(t) ? t : {};
        return {
          id: `${callId}-t-${i}`,
          speaker: r.speaker === 'agent' ? ('agent' as const) : ('caller' as const),
          timestampSec: i * 12,
          text: str(r.text, 1000),
        };
      }),
    };
    ws.leads.unshift(lead);
    ws.calls.unshift(call);
    store.notify(ws, {
      type: urgency === 'Emergency' ? 'Urgent Lead' : 'New Lead',
      title: `${urgency} test intake — ${lead.name}`,
      body: `${serviceType} (${trade}) saved from a Test Agent session.`,
      targetPath: `/app/leads/${leadId}`,
    });
    res.status(201).json({call, lead});
  });

  // Simulated inbound test call (no real telephony is connected).
  app.post('/api/system-voice/inbound', testCallLimiter, (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const ws = ctx.workspace;
    const callId = newId(`${ws.organizationId}-sys`);
    const call: CallItem = {
      id: callId,
      organizationId: ws.organizationId,
      callerName: 'Simulated Test Caller',
      callerPhone: 'Test line',
      address: 'N/A (simulated)',
      zip: ws.voiceAgent.serviceAreas[0] ?? '',
      trade: 'Plumbing',
      serviceRequested: `Simulated routing test for ${ws.phoneSetup.systemNumber}`,
      answeredBy: 'AI',
      status: 'Answered',
      urgency: 'Normal',
      durationSec: 30,
      pickupRings: 1,
      estimatedValue: 0,
      createdAt: 'Just now',
      createdAtISO: nowIso(),
      dayOffset: 0,
      hourOfDay: new Date().getHours(),
      aiSummary: 'Simulated test call generated from the console. No real call was placed.',
      recordingAvailable: false,
      isTest: true,
      waveform: Array.from({length: 16}, () => 30 + crypto.randomInt(0, 50)),
      transcript: [{id: `${callId}-1`, speaker: 'agent', timestampSec: 0, text: ws.voiceAgent.greetingMessage}],
    };
    ws.calls.unshift(call);
    ws.phoneSetup.lastSystemTestAt = 'Simulated test just now';
    store.notify(ws, {
      type: 'System',
      title: 'Simulated test call logged',
      body: 'A simulated call was added. Connect a telephony provider to receive real calls.',
      targetPath: `/app/calls/${callId}`,
    });
    res.status(201).json({call, phoneSetup: ws.phoneSetup});
  });

  // ----- Email alerts (replace paid SMS alerts to the owner) -----
  // Goes to Settings > dispatch email (e.g. a Gmail address), falling back to the Owner's login email. The outcome is also
  // written into the lead's internal notes, so it is visible inside the lead itself.
  type AlertJob = {kind: 'emergency' | 'new-lead' | 'missed-call'; leadId?: string; name: string; phone: string; summary: string};
  const alertRecipient = (w: TenantWorkspace): string | null => {
    const d = (w.settings.dispatchEmail || '').trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d)) return d;
    return w.team.find((m) => m.role === 'Owner' && /@/.test(m.email))?.email ?? null;
  };
  const emailAlert = async (orgId: string, w: TenantWorkspace, job: AlertJob): Promise<void> => {
    const to = alertRecipient(w);
    if (!to) return;
    const base = process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' ? process.env.APP_URL.replace(/\/$/, '') : '';
    const sent = mailConfigured()
      ? await sendMail(leadAlertEmail({to, businessName: w.voiceAgent.businessName, kind: job.kind, name: job.name, phone: job.phone, summary: job.summary, url: base && job.leadId ? `${base}/app/leads/${job.leadId}` : undefined}))
      : false;
    if (!job.leadId) return;
    const label = job.kind === 'emergency' ? 'Emergency' : job.kind === 'missed-call' ? 'Missed-call' : 'New-lead';
    const line = `[${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC] ${label} alert ${sent ? `emailed to ${to}` : 'NOT emailed (email is not configured or failed)'}: ${job.summary.slice(0, 140)}`;
    await store.mutateWorkspace(orgId, (cur) => {
      const lead = cur.leads.find((l) => l.id === job.leadId);
      if (lead) lead.internalNotes = `${lead.internalNotes ? `${lead.internalNotes}\n` : ''}${line}`.slice(-3800);
    });
  };

  // ----- Missed-call automatic text-back -----
  // Sends at most one text per caller per 24h, only when the workspace enabled it, SMS is configured, the number has not
  // opted out, and it is inside 8am-9pm business time. Every attempt that sends is recorded as a follow-up + notification.
  const missedCallTextBack = async (orgId: string, w: TenantWorkspace, fromRaw: string): Promise<{sent: boolean; reason?: string}> => {
    const prefs = w.settings.notificationPreferences;
    const to = toE164(fromRaw);
    if (!prefs.missedCallTextBackEnabled) return {sent: false, reason: 'disabled'};
    if (!planAllows(w, 'missedCallText')) return {sent: false, reason: 'plan'};
    if (!telnyxSmsConfigured()) return {sent: false, reason: 'sms-not-configured'};
    if (!to) return {sent: false, reason: 'invalid-number'};
    if (!withinTextingHours(w.settings.timezone)) return {sent: false, reason: 'quiet-hours'};
    // Consent first. A caller who phoned us is treated as having asked us to reply about that request (purpose "service" only),
    // and that is written to the ledger and saved BEFORE the text goes out. Opt-outs and withdrawals always block.
    // Set SMS_REQUIRE_EXPLICIT_CONSENT=1 to disable the inbound-call basis and require a prior consent record instead.
    let consent = checkSmsConsent(w, to, 'service');
    if (!consent.ok && consent.reason !== 'no-consent' && consent.reason !== 'purpose-not-covered') return {sent: false, reason: consent.reason};
    if (!consent.ok) {
      if (process.env.SMS_REQUIRE_EXPLICIT_CONSENT === '1') return {sent: false, reason: 'no-consent'};
      try {
        await store.mutateWorkspace(orgId, (cur) => {
          grantSmsConsent(cur, {phone: to, purposes: ['service'], source: 'inbound_call', evidence: 'Customer called the business; reply limited to that request', nowISO: nowIso()});
        });
      } catch (e) {
        console.error('[consent] could not record inbound-call consent:', e instanceof Error ? e.message : e);
        return {sent: false, reason: 'consent-not-recorded'};
      }
      consent = {ok: true, record: {phone: to, purposes: ['service'], source: 'inbound_call', capturedAtISO: nowIso()}};
    }
    const seen = await store.hit(`missed-sms:${orgId}:${to}`, 24 * 60 * 60 * 1000);
    if (seen.count > 1) return {sent: false, reason: 'already-texted-today'};
    const link = w.extras?.bookingLink;
    const text = `${w.voiceAgent.businessName}: Sorry we missed your call! Reply with what you need and we will get right back to you${link ? `, or book here: ${link}` : ''}. ${prefs.tcpaFooterText}`.slice(0, 600);
    const last4 = to.slice(-4);
    const fuId = newId(`${orgId}-f`);
    let queued = false;
    try {
      await store.mutateWorkspace(orgId, (cur) => {
        queued = false;
        // Queued in the same save as the follow-up record; sent after it commits (dedupe: one per caller per day).
        if (!queueSms(cur, {dedupeKey: `missed:${to}:${nowIso().slice(0, 10)}`, to, text, purpose: 'service', followUpId: fuId}).created) return;
        queued = true;
        cur.followUps.unshift({
        id: fuId, organizationId: orgId, leadId: '', customerName: `Caller …${last4}`, phone: to, trade: 'Plumbing',
        triggerReason: 'Missed Call Text-Back', messagePreview: text, consentOptIn: true, consentSource: consent.record.source, consentAtISO: consent.record.capturedAtISO,
        status: 'Pending', scheduledFor: 'Sending…',
        });
        store.notify(cur, {type: 'Missed Call', title: `Missed call text-back queued`, body: `Texting …${last4} after a missed call.`, targetPath: '/app/followups'});
      });
    } catch (e) {
      console.error('[outbox] could not queue missed-call text:', e instanceof Error ? e.message : e);
      return {sent: false, reason: 'queue-failed'};
    }
    if (queued) await Promise.race([dispatchOutbox(orgId), sleep(4000)]).catch(() => {});
    return {sent: queued};
  };

  /** Job finished: text the customer a review link when the owner turned auto-send on (once per lead). Never blocks. */
  const afterLeadConverted = async (ws: TenantWorkspace, lead: LeadItem) => {
    const rr = ws.extras?.reviewRequest;
    if (!rr?.enabled || !rr.auto || lead.isTest) return;
    const r = await sendReviewRequest(ws, lead);
    if (!r.ok) console.error(`[review] auto request skipped for ${lead.id}: ${r.error}`);
  };

  /** Texts a Google review link for a finished job. Mutates the passed workspace (saved with the request). */
  const sendReviewRequest = async (ws: TenantWorkspace, lead: LeadItem): Promise<{ok: boolean; error?: string}> => {
    const rr = ws.extras?.reviewRequest;
    if (!rr?.link) return {ok: false, error: 'Add your Google review link under Integrations first.'};
    if (lead.reviewRequestedAtISO) return {ok: false, error: 'A review request was already sent for this lead.'};
    if (!accessFor(ws).allowed) return {ok: false, error: BLOCKED_MESSAGE};
    if (!telnyxSmsConfigured()) return {ok: false, error: 'Text messaging is not set up on the server yet.'};
    const to = toE164(lead.phone);
    if (!to) return {ok: false, error: 'This lead has no valid mobile number.'};
    const consent = checkSmsConsent(ws, to, 'review_request');
    if (!consent.ok) return {ok: false, error: consentErrorMessage(consent.reason)};
    if (!withinTextingHours(ws.settings.timezone)) return {ok: false, error: 'Texts are only sent between 8am and 9pm business time. Try again later.'};
    const first = lead.name.trim().split(/\s+/)[0] || 'there';
    const footer = ws.settings.notificationPreferences.tcpaFooterText || 'Reply STOP to opt out.';
    const text = `${ws.voiceAgent.businessName}: Thanks for choosing us, ${first}! If we did a good job, would you leave us a quick review? ${rr.link} ${footer}`.slice(0, 600);
    // Queued in the same save as the lead change. If that save loses a race and the request is retried, nothing was stored,
    // so the customer is not texted twice. The text is sent after the commit.
    const fuId = newId(`${ws.organizationId}-f`);
    const queued = queueSms(ws, {dedupeKey: `review:${lead.id}`, to, text, purpose: 'review_request', followUpId: fuId, after: {kind: 'review', id: lead.id}});
    if (!queued.created) return {ok: false, error: 'A review request was already queued for this lead.'};
    lead.reviewRequestedAtISO = nowIso();
    ws.followUps.unshift({
      id: fuId, organizationId: ws.organizationId, leadId: lead.id, customerName: lead.name, phone: to,
      trade: lead.trade, triggerReason: 'Post-Job Review', messagePreview: text, consentOptIn: true, consentSource: consent.record.source, consentAtISO: consent.record.capturedAtISO,
      status: 'Pending', scheduledFor: 'Sending…',
    });
    return {ok: true};
  };

  // ----- Telnyx AI Assistant webhooks (real calls) -----
  // Point each customer's Telnyx AI Assistant at /api/webhooks/telnyx/<organizationId>. The Ed25519 signature
  // proves the request came from Telnyx, so a customer cannot forge calls into another workspace.
  app.post('/api/webhooks/telnyx/:orgId', webhookIpLimiter, async (req, res) => {
    const raw = (req as Request & {rawBody?: Buffer}).rawBody;
    if (!verifyTelnyxWebhook(raw, req.header('telnyx-signature-ed25519'), req.header('telnyx-timestamp'))) {
      res.status(401).json({error: 'Invalid webhook signature.'});
      return;
    }
    const ev = parseTelnyxCallEvent(req.body);
    if (!ev || (ev.eventType !== 'call.conversation.ended' && ev.eventType !== 'call.analyzed')) {
      res.json({received: true, ignored: true});
      return;
    }
    if (ev.eventId) {
      const seen = await store.hit(`telnyx-evt:${ev.eventId}`, 24 * 60 * 60 * 1000);
      if (seen.count > 1) {
        res.json({received: true, duplicate: true});
        return;
      }
    }
    const orgId = str(req.params.orgId, 120);
    const transcript = ev.transcript.length ? ev.transcript : await fetchConversationTranscript(ev.conversationId);
    const safeConv = ev.conversationId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);

    let found = false;
    let alert: {to: string; text: string} | null = null;
    let events: {type: 'lead_created' | 'call_completed' | 'emergency_detected'; data: unknown}[] = [];
    let snap: TenantWorkspace | null = null;
    let missedFrom: string | null = null;
    let jobs: AlertJob[] = [];
    await store.mutateWorkspace(orgId, (ws) => {
      found = true;
      alert = null;
      events = [];
      jobs = [];
      missedFrom = null;
      snap = ws;
      const callId = `${ws.organizationId}-tx-${safeConv}`;
      const existing = ws.calls.find((c) => c.id === callId);
      // Provider URLs are only kept when they point at an allowlisted https host (see server/recordings.ts).
      const recordingUrlOk = Boolean(ev.recordingUrl && parseRecordingUrl(ev.recordingUrl));
      if (existing) {
        // call.analyzed after call.conversation.ended: enrich, never duplicate.
        if (recordingUrlOk) {
          existing.recordingUrl = ev.recordingUrl;
          existing.recordingAvailable = true;
        }
        if (ev.summary) existing.aiSummary = ev.summary;
        if (transcript.length && existing.transcript.length <= 1) {
          existing.transcript = transcript.map((t, i) => ({id: `${callId}-t-${i}`, speaker: t.speaker, timestampSec: i * 12, text: t.text}));
        }
        return;
      }
      const callerText = transcript.filter((t) => t.speaker === 'caller').map((t) => t.text).join(' ');
      const hit = matchEmergency(callerText, ws.settings.emergencyRules.keywords);
      const urgency = hit ? ('Emergency' as const) : ('Normal' as const);
      const trade = /electric|outlet|breaker|panel|wiring|spark|power out/i.test(callerText) ? ('Electrical' as const) : ('Plumbing' as const);
      const phone = ev.from || 'Unknown';
      const last4 = phone.replace(/\D/g, '').slice(-4);
      const name = last4 ? `Caller …${last4}` : 'Phone Caller';
      const description = ev.summary || callerText.slice(0, 300) || 'Phone call answered by the AI receptionist.';
      const iso = nowIso();
      const isSpam = ev.durationSec < 5 && transcript.length === 0;
      const {tags, nextSteps} = tagCall({urgency, durationSec: ev.durationSec, callerText});
      // Caller hung up before saying anything useful = a missed call (spam is never texted).
      const missed = ev.durationSec < 15 && !callerText.trim();
      if (missed && !tags.includes('spam') && phone !== 'Unknown') missedFrom = phone;
      // If the assistant already filed a callback request for this conversation, link to it instead of creating a second lead.
      const cbLeadId = `${ws.organizationId}-lcb-${safeConv}`;
      const cbExists = ws.leads.some((l) => l.id === cbLeadId);
      if (cbExists && !tags.includes('callback')) tags.push('callback');
      const leadId = cbExists ? cbLeadId : isSpam ? undefined : newId(`${ws.organizationId}-l`);

      const loc = planAllows(ws, 'multiLocation') ? routeLocation(ws, '', callerText) : null;
      ws.calls.unshift({
        id: callId,
        organizationId: ws.organizationId,
        callerName: name,
        callerPhone: phone,
        address: '',
        zip: '',
        locationId: loc?.id,
        trade,
        serviceRequested: description.slice(0, 140),
        answeredBy: 'AI',
        status: missed ? 'Missed' : 'Answered',
        urgency,
        durationSec: ev.durationSec,
        pickupRings: 1,
        estimatedValue: 0,
        createdAt: 'Just now',
        createdAtISO: iso,
        dayOffset: 0,
        hourOfDay: new Date().getHours(),
        aiSummary: description,
        recordingAvailable: recordingUrlOk,
        recordingUrl: recordingUrlOk ? ev.recordingUrl : undefined,
        externalId: ev.conversationId,
        tags,
        nextSteps,
        channel: 'phone',
        language: detectLanguage(callerText),
        linkedLeadId: leadId,
        waveform: Array.from({length: 36}, () => 24 + crypto.randomInt(0, 64)),
        transcript: transcript.map((t, i) => ({id: `${callId}-t-${i}`, speaker: t.speaker, timestampSec: i * 12, text: t.text})),
      });
      const usedBefore = ws.billing.minutesUsed;
      ws.billing.minutesUsed += Math.ceil(ev.durationSec / 60);
      {
        const extraNow = Math.max(0, ws.billing.minutesUsed - Math.max(ws.billing.minutesIncluded, usedBefore));
        const cust = ws.secrets?.stripeCustomerId;
        if (extraNow > 0 && cust && stripeConfigured()) void reportOverageMinutes(cust, extraNow, `ovg-${callId}`);
      }
      // Usage alerts. Calls are never cut off at the limit (a plumbing emergency must still be answered); the owner is told instead.
      {
        const b = ws.billing;
        const pct = b.minutesIncluded > 0 ? (b.minutesUsed / b.minutesIncluded) * 100 : 0;
        const level = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
        if (level > (b.usageNotice ?? 0)) {
          b.usageNotice = level as 80 | 100;
          store.notify(ws, {
            type: 'System',
            title: level === 100 ? 'AI minutes used up' : 'AI minutes almost used up',
            body: level === 100
              ? `You have used all ${b.minutesIncluded} minutes on the ${b.plan} plan. Calls are still answered, and extra minutes are counted. Upgrade under Billing to add more.`
              : `You have used ${b.minutesUsed} of ${b.minutesIncluded} minutes on the ${b.plan} plan this period.`,
            targetPath: '/app/billing',
          });
        }
      }
      events.push({type: 'call_completed', data: {id: callId, from: phone, durationSec: ev.durationSec, urgency, tags, summary: description}});
      if (!leadId || cbExists) return;
      ws.leads.unshift({
        id: leadId,
        organizationId: ws.organizationId,
        name,
        phone,
        email: '',
        trade,
        serviceType: 'Phone Inquiry',
        problemDescription: description,
        zip: '',
        fullAddress: 'Address pending confirmation',
        urgency,
        preferredAppointment: 'Next Available',
        leadSource: 'AI Phone Receptionist',
        callDurationSec: ev.durationSec,
        linkedCallId: callId,
        createdAt: 'Just now',
        createdAtISO: iso,
        dayOffset: 0,
        status: urgency === 'Emergency' ? 'Qualified' : 'New',
        estimatedValue: 0,
        internalNotes: `Created from a real Telnyx call. Review the transcript to confirm name and address.${loc ? ` Routed to ${loc.name}.` : ''}`,
        locationId: loc?.id,
      });
      store.notify(ws, {
        type: urgency === 'Emergency' ? 'Urgent Lead' : 'New Lead',
        title: `${urgency} call — ${name}`,
        body: description.slice(0, 200),
        targetPath: `/app/leads/${leadId}`,
      });
      events.push({type: 'lead_created', data: {id: leadId, name, phone, trade, urgency, serviceType: 'Phone Inquiry', summary: description, source: 'AI Phone Receptionist'}});
      if (missedFrom) jobs.push({kind: 'missed-call', leadId, name, phone, summary: 'The caller hung up before speaking.'});
      else if (urgency === 'Emergency') jobs.push({kind: 'emergency', leadId, name, phone, summary: description});
      else if (ws.settings.notificationPreferences.smsOnNewLead) jobs.push({kind: 'new-lead', leadId, name, phone, summary: description});
      if (urgency === 'Emergency') {
        events.push({type: 'emergency_detected', data: {leadId, phone, reason: hit}});
        alert = buildEmergencyAlert(ws, phone, description, leadId, loc);
      }
    });
    if (!found) {
      res.status(404).json({error: 'Unknown organization.'});
      return;
    }
    const eventWs = snap as TenantWorkspace | null;
    if (eventWs) for (const e of events) emitEvent(eventWs, e.type, e.data);
    if (eventWs && jobs.length) void Promise.all(jobs.map((j) => emailAlert(orgId, eventWs, j))).catch(() => {});
    const missedNumber = missedFrom as string | null;
    if (eventWs && missedNumber) await missedCallTextBack(orgId, eventWs, missedNumber);
    const pending = alert as {to: string; text: string} | null;
    if (pending && telnyxSmsConfigured()) {
      const sent = await sendTelnyxSms(pending.to, pending.text);
      if (!sent.ok) console.error('[telnyx] emergency SMS failed:', sent.error);
    }
    res.json({received: true});
  });

  // Owner removes one stored recording. The transcript, summary and lead stay.
  app.delete('/api/calls/:id/recording', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const call = ctx.workspace.calls.find((c) => c.id === req.params.id);
    if (!call?.recordingUrl) {
      res.status(404).json({error: 'This call has no stored recording.'});
      return;
    }
    delete call.recordingUrl;
    call.recordingAvailable = false;
    call.recordingDeletedAtISO = nowIso();
    res.json({ok: true});
  });

  // Streams the stored provider recording for a call (temporary provider URLs are never exposed to other tenants).
  const recordingLimiter = createRateLimiter({
    name: 'recording',
    windowMs: 60_000,
    max: 60, // a player seeking sends several range requests per play
    key: (req) => orgOf(req) || secretBucket(getToken(req)) || clientIp(req),
    message: 'Too many recording requests. Please wait a moment.',
  });
  app.get('/api/calls/:id/recording', recordingLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Viewer']);
    if (!ctx) return;
    const call = ctx.workspace.calls.find((c) => c.id === req.params.id);
    if (!call?.recordingUrl) {
      res.status(404).json({error: 'No recording is available for this call.'});
      return;
    }
    let rec: Awaited<ReturnType<typeof openRecording>>;
    try {
      rec = await openRecording(call.recordingUrl, safeRange(req.headers.range));
    } catch (e) {
      console.error('[recording] refused or failed:', e instanceof Error ? e.message : e);
      res.status(502).json({error: 'The recording is no longer available from the provider.'});
      return;
    }
    res.status(rec.status);
    res.setHeader('Content-Type', rec.headers.contentType);
    if (rec.headers.contentLength) res.setHeader('Content-Length', rec.headers.contentLength);
    if (rec.headers.contentRange) res.setHeader('Content-Range', rec.headers.contentRange);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', 'inline; filename="call-recording"');
    // Stop pulling from the provider the moment the listener goes away or the size cap trips.
    res.on('close', () => rec.abort());
    rec.stream.on('error', () => res.destroy());
    rec.stream.pipe(res);
  });

  // =====================================================================================================
  // Additive feature routes: workspace extras, outgoing webhooks, website chat widget, website knowledge
  // import, Google Calendar, in-call SMS / missed-call tools, inbound SMS opt-out.
  // =====================================================================================================
  const ORG_RE = /^[A-Za-z0-9_-]{3,80}$/;
  const sanitizeDomains = (v: unknown): string[] =>
    (Array.isArray(v) ? v : [])
      .map((d) => str(d, 120).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
      .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
      .slice(0, 20);
  const originAllowed = (origin: string | undefined, domains: string[]) => {
    if (!origin || !domains.length) return false;
    try {
      const h = new URL(origin).hostname.toLowerCase().replace(/^www\./, '');
      return domains.some((d) => h === d || h.endsWith(`.${d}`));
    } catch {
      return false;
    }
  };
  const toolToken = (orgId: string) => hmacHex(orgId, 'tool-token');
  // Secret part of the TeXML URLs (so only Telnyx, who we gave the URL to, can fetch the owner's phone number).
  // After the Owner rotates once, the workspace uses a random per-organization secret (sealed in ws.secrets.ringToken).
  // Older workspaces still use the legacy HMAC(orgId) value until the Owner rotates once; it is never sent in /api/extras.
  const legacyRingToken = (orgId: string) => hmacHex(orgId, 'ring-first-token');
  const ringTokenOf = (ws: TenantWorkspace): {token: string | null; legacy: boolean} => {
    const stored = unseal(ws.secrets?.ringToken);
    if (stored) return {token: stored, legacy: false};
    return {token: legacyRingToken(ws.organizationId), legacy: true};
  };
  const googleToken = async (w: TenantWorkspace): Promise<string | null> => {
    const rt = unseal(w.secrets?.googleRefreshToken);
    if (!rt || !w.extras?.googleCalendar?.connected) return null;
    try {
      return await accessTokenFrom(rt);
    } catch {
      return null;
    }
  };

  // ----- outbox: external actions are queued inside the workspace save and performed after it commits (server/outbox.ts) -----
  const stableId = (...parts: string[]) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
  /** Same Idempotency-Key => same id, so a retried create never produces a second record. Without the header: a fresh id. */
  const idemId = (ctx: Ctx, scope: string, prefix: string) => (ctx.idemKey ? `${prefix}-${stableId(ctx.workspace.organizationId, ctx.idemKey, scope)}` : newId(prefix));

  const queueSms = (ws: TenantWorkspace, o: {dedupeKey: string; to: string; text: string; purpose: SmsConsentPurpose; followUpId?: string; after?: OutboxEntry['after']}) =>
    enqueueOutbox(ws, {
      id: newId(`${ws.organizationId}-o`), dedupeKey: o.dedupeKey, kind: 'sms', nowISO: nowIso(), after: o.after,
      payload: {to: o.to, text: o.text, purpose: o.purpose, followUpId: o.followUpId},
    });

  /** Webhook with a stable event id (derived from the dedupe key), so receivers can de-duplicate. Same gates as emitEvent. */
  const queueWebhook = (ws: TenantWorkspace, type: Parameters<typeof emitEvent>[1], data: unknown, entityId: string) => {
    const cfg = ws.extras?.webhook;
    if (!cfg?.enabled || !cfg.url || !ws.secrets?.webhookSecret || !cfg.events.includes(type) || !planAllows(ws, 'webhooks')) return;
    const dedupeKey = `wh:${type}:${entityId}`;
    enqueueOutbox(ws, {id: newId(`${ws.organizationId}-o`), dedupeKey, kind: 'webhook', nowISO: nowIso(), payload: {type, data, eventId: `evt_${stableId(ws.organizationId, dedupeKey)}`}});
  };

  const smsFailure = (error: string): Outcome => {
    // A response from Telnyx is a definite answer. A timeout or network error is ambiguous (the text may have gone out),
    // so it is NOT retried: better a missed text than a duplicate one.
    if (/returned (429|5\d\d)/.test(error)) return {ok: false, error};
    if (/returned 4\d\d/.test(error)) return {ok: false, error, permanent: true};
    return {ok: false, error: `Delivery unknown (${error}). Not retried to avoid a duplicate text.`, permanent: true};
  };

  const dispatchOutbox = createDispatcher({
    store,
    handlers: {
      sms: async (ws, e) => {
        const to = String(e.payload.to ?? '');
        const purpose = e.payload.purpose as SmsConsentPurpose;
        const c = checkSmsConsent(ws, to, purpose); // a STOP or withdrawal after queueing still wins
        if (!c.ok) return {ok: 'cancelled', reason: consentErrorMessage(c.reason)};
        if (!telnyxSmsConfigured()) return {ok: false, error: 'Text messaging is not set up on the server.', permanent: true};
        const r = await sendTelnyxSms(to, String(e.payload.text ?? ''));
        return r.ok ? {ok: true} : smsFailure(r.error ?? 'SMS failed');
      },
      webhook: async (ws, e) => {
        const cfg = ws.extras?.webhook;
        const secret = ws.secrets?.webhookSecret;
        if (!cfg?.enabled || !cfg.url || !secret) return {ok: 'cancelled', reason: 'Webhook is turned off.'};
        const r = await deliverWebhook(ws.organizationId, cfg.url, secret, String(e.payload.type), e.payload.data, String(e.payload.eventId));
        return r.ok ? {ok: true} : {ok: false, error: r.error ?? 'Webhook failed', permanent: r.status >= 400 && r.status < 500 && r.status !== 429};
      },
      gcal: async (ws, e) => {
        const appt = ws.appointments.find((a) => a.id === e.payload.appointmentId);
        if (!appt) return {ok: 'cancelled', reason: 'Appointment no longer exists.'};
        const token = await googleToken(ws);
        if (!token) return {ok: false, error: 'Google Calendar is not connected.', permanent: true};
        await upsertEvent(token, ws.extras?.googleCalendar?.calendarId || 'primary', appt, ws.settings.timezone); // event id is derived from appt.id
        return {ok: true};
      },
    },
    onSettled: (ws, e) => {
      const done = e.status === 'sent';
      const finished = done || e.status === 'failed' || e.status === 'cancelled';
      if (!finished) return;
      const fuId = typeof e.payload.followUpId === 'string' ? e.payload.followUpId : '';
      const fu = fuId ? ws.followUps.find((f) => f.id === fuId) : undefined;
      if (fu) {
        fu.status = done ? 'Sent' : 'Pending';
        fu.scheduledFor = done ? 'Sent just now' : 'Not sent';
        if (!done) fu.consentOptIn = fu.consentOptIn && e.status !== 'cancelled';
      }
      const a = e.after;
      if (a?.kind === 'quote') {
        const q = ws.quotes?.find((x) => x.id === a.id);
        if (q && done) q.sentAtISO = nowIso();
        else if (q) store.notify(ws, {type: 'System', title: `Quote text not sent — ${q.customerName}`, body: e.lastError || 'The text could not be delivered.', targetPath: `/app/leads/${q.leadId}`});
      } else if (a?.kind === 'review' && !done) {
        const lead = ws.leads.find((l) => l.id === a.id);
        if (lead) {
          lead.reviewRequestedAtISO = undefined; // lets the owner try again
          store.notify(ws, {type: 'System', title: `Review request not sent — ${lead.name}`, body: e.lastError || 'The text could not be delivered.', targetPath: `/app/leads/${lead.id}`});
        }
      } else if (a?.kind === 'appointment') {
        const ap = ws.appointments.find((x) => x.id === a.id);
        if (ap) {
          ap.googleSynced = done;
          if (done) ap.googleEventId = eventIdFor(ap.id);
        }
      }
    },
  });
  const runOutbox = async (): Promise<number> => {
    let n = 0;
    try {
      for (const orgId of await store.listWorkspaceIdsWithDueOutbox(nowIso())) n += await dispatchOutbox(orgId);
    } catch (e) {
      console.error('[outbox] sweep failed:', e instanceof Error ? e.message : e);
    }
    return n;
  };

  // Paid-feature gate for public and tool endpoints. Also starts the trial clock of older workspaces.
  const orgAllowed = async (orgId: string): Promise<boolean> => {
    const ws = ORG_RE.test(orgId) ? await store.peekWorkspace(orgId) : null;
    if (!ws) return false;
    if (stripeConfigured() && !ws.billing.trialStartedAtISO) {
      const iso = nowIso();
      ws.billing.trialStartedAtISO = iso;
      await store.mutateWorkspace(orgId, (w) => {
        w.billing.trialStartedAtISO = w.billing.trialStartedAtISO ?? iso;
      });
    }
    return accessFor(ws).allowed;
  };

  const toolAuth = (req: Request, res: Response): string | null => {
    const orgId = str(req.params.orgId, 80);
    const expected = ORG_RE.test(orgId) ? toolToken(orgId) : null;
    const given = req.header('x-plumbvoice-tool-token') || '';
    if (!expected || !safeEqual(given, expected)) {
      res.status(401).json({error: 'Invalid tool token.'});
      return null;
    }
    return orgId;
  };

  // ----- workspace extras (webhook, chat widget, booking link, languages) -----
  app.get('/api/extras', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Viewer']);
    if (!ctx) return;
    // The consent ledger is read per lead (GET /api/leads/:id/sms-consent), not shipped to every dashboard load.
    const {smsConsents: _ledger, ...e} = ctx.workspace.extras ?? {};
    res.json({
      organizationId: ctx.workspace.organizationId,
      extras: e,
      webhookConfigured: Boolean(ctx.workspace.secrets?.webhookSecret),
      googleConfigured: gcalConfigured(),
      toolTokenAvailable: Boolean(toolToken(ctx.workspace.organizationId)),
      // The ring-first URL secret is NOT part of this response (Dispatcher/Viewer can read it). Owners fetch it from
      // GET /api/extras/ring-token, which needs step-up.
      ringTokenAvailable: secretsConfigured(),
      ringTokenLegacy: ctx.session.role === 'Owner' ? ringTokenOf(ctx.workspace).legacy : undefined,
      team: ctx.workspace.team.map((m) => ({id: m.id, name: m.name, role: m.role})),
      features: featureAccess(ctx.workspace),
    });
  });

  app.patch('/api/extras', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const ws = ctx.workspace;
    const b = isRecord(req.body) ? req.body : {};
    const next = {...(ws.extras ?? {})};
    let newSecret: string | undefined;

    if (isRecord(b.webhook) && b.webhook.enabled === true && !planAllows(ws, 'webhooks')) {
      res.status(402).json({error: upgradeMessage('webhooks'), code: 'plan_required'});
      return;
    }
    if (isRecord(b.ringFirst) && b.ringFirst.enabled === true && !planAllows(ws, 'ringFirst')) {
      res.status(402).json({error: upgradeMessage('ringFirst'), code: 'plan_required'});
      return;
    }
    if (isRecord(b.bookingPage) && b.bookingPage.enabled === true && !planAllows(ws, 'bookingPage')) {
      res.status(402).json({error: upgradeMessage('bookingPage'), code: 'plan_required'});
      return;
    }
    if (isRecord(b.webhook)) {
      const url = str(b.webhook.url, 500);
      const events = (Array.isArray(b.webhook.events) ? b.webhook.events : []).filter((e): e is (typeof WEBHOOK_EVENTS)[number] => (WEBHOOK_EVENTS as readonly unknown[]).includes(e));
      if (url && !url.startsWith('https://')) {
        res.status(400).json({error: 'The webhook URL must start with https://'});
        return;
      }
      next.webhook = {url, enabled: b.webhook.enabled === true && Boolean(url), events: events.length ? events : [...WEBHOOK_EVENTS]};
      if (url && !ws.secrets?.webhookSecret) {
        newSecret = crypto.randomBytes(24).toString('hex');
        ws.secrets = {...(ws.secrets ?? {}), webhookSecret: newSecret};
      }
    }
    if (isRecord(b.chatWidget)) {
      next.chatWidget = {
        enabled: b.chatWidget.enabled === true,
        allowedDomains: sanitizeDomains(b.chatWidget.allowedDomains),
        welcome: str(b.chatWidget.welcome, 200) || 'Hi! How can we help today?',
      };
    }
    if (typeof b.bookingLink === 'string') {
      const link = str(b.bookingLink, 300);
      if (link && !link.startsWith('https://')) {
        res.status(400).json({error: 'The booking link must start with https://'});
        return;
      }
      next.bookingLink = link;
    }
    if (isRecord(b.reviewRequest)) {
      const link = str(b.reviewRequest.link, 300);
      if (link && !/^https:\/\//.test(link)) {
        res.status(400).json({error: 'The Google review link must start with https://'});
        return;
      }
      next.reviewRequest = {enabled: b.reviewRequest.enabled === true && Boolean(link), auto: b.reviewRequest.auto === true, link};
    }
    if (isRecord(b.recording)) {
      const days = Math.round(num(b.recording.retentionDays, 0, 3650) ?? 0);
      next.recording = {consentNotice: str(b.recording.consentNotice, 300), retentionDays: days};
    }
    if (Array.isArray(b.locations)) {
      if (b.locations.length && !planAllows(ws, 'multiLocation')) {
        res.status(402).json({error: upgradeMessage('multiLocation'), code: 'plan_required'});
        return;
      }
      const seenZips = new Set<string>();
      const locs: LocationItem[] = [];
      for (const raw of b.locations.slice(0, 20)) {
        if (!isRecord(raw)) continue;
        const name = str(raw.name, 80);
        if (!name) continue;
        const zips = (Array.isArray(raw.zips) ? raw.zips : String(raw.zips ?? '').split(/[\s,]+/))
          .map((z: unknown) => String(z).trim())
          .filter((z: string) => /^\d{5}$/.test(z));
        const dup = zips.find((z: string) => seenZips.has(z));
        if (dup) {
          res.status(400).json({error: `ZIP ${dup} is listed under more than one location. Each ZIP can belong to only one.`});
          return;
        }
        zips.forEach((z: string) => seenZips.add(z));
        const phone = str(raw.phone, 30);
        if (phone && !toE164(phone)) {
          res.status(400).json({error: `The phone number for ${name} does not look valid.`});
          return;
        }
        const id = /^loc-[A-Za-z0-9-]{4,40}$/.test(String(raw.id ?? '')) ? String(raw.id) : newId('loc');
        const teamIds = (Array.isArray(raw.teamMemberIds) ? raw.teamMemberIds : []).filter((t: unknown): t is string => typeof t === 'string' && ws.team.some((m) => m.id === t));
        locs.push({id, name, address: str(raw.address, 200), zips: [...new Set<string>(zips)].slice(0, 200), phone: phone ? toE164(phone) : '', hours: str(raw.hours, 200), teamMemberIds: teamIds});
      }
      next.locations = locs;
    }
    if (isRecord(b.ringFirst)) {
      const rf = b.ringFirst;
      const ownerPhone = toE164(str(rf.ownerPhone, 30));
      const assistantId = str(rf.assistantId, 100);
      const seconds = Math.min(30, Math.max(10, Math.round(num(rf.seconds, 5, 120) ?? 20)));
      if (assistantId && !/^assistant-[A-Za-z0-9-]{8,80}$/.test(assistantId)) {
        res.status(400).json({error: 'The AI assistant ID should look like assistant-xxxxxxxx-xxxx-… (copy it from Telnyx).'});
        return;
      }
      if (rf.enabled === true && (!ownerPhone || !assistantId)) {
        res.status(400).json({error: 'Enter your own mobile number and the Telnyx assistant ID before turning this on.'});
        return;
      }
      next.ringFirst = {enabled: rf.enabled === true, ownerPhone, seconds, assistantId};
    }
    if (isRecord(b.bookingPage)) {
      next.bookingPage = {enabled: b.bookingPage.enabled === true, intro: str(b.bookingPage.intro, 300) || 'Tell us what you need and we will confirm a time with you.'};
    }
    if (Array.isArray(b.languages)) {
      const langs = b.languages.filter((l): l is 'en' | 'es' => l === 'en' || l === 'es');
      next.languages = langs.length ? langs : ['en'];
    }
    ws.extras = next;
    // The webhook secret is returned exactly once, when it is created.
    res.json({extras: next, ...(newSecret ? {webhookSecret: newSecret} : {})});
  });

  app.get('/api/extras/webhook/log', async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    res.json({log: await getWebhookLog(ctx.workspace.organizationId)});
  });

  app.post('/api/extras/webhook/test', externalCallLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const cfg = ctx.workspace.extras?.webhook;
    const secret = ctx.workspace.secrets?.webhookSecret;
    if (!cfg?.url || !secret) {
      res.status(400).json({error: 'Save a webhook URL first.'});
      return;
    }
    const result = await deliverWebhook(ctx.workspace.organizationId, cfg.url, secret, 'test', {message: 'PlumbVoice test event'});
    res.json({result});
  });

  app.get('/api/tools/token', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const token = toolToken(ctx.workspace.organizationId);
    if (!token) {
      res.status(400).json({error: 'Set SECRETS_KEY on the server first.'});
      return;
    }
    res.json({organizationId: ctx.workspace.organizationId, token});
  });

  // Ring-first URL secret: Owner only, step-up enforced by server/stepUpPolicy.ts.
  app.get('/api/extras/ring-token', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const {token, legacy} = ringTokenOf(ctx.workspace);
    if (!token) {
      res.status(400).json({error: 'Set SECRETS_KEY on the server first.'});
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({organizationId: ctx.workspace.organizationId, token, legacy});
  });

  // Rotate: old URL stops working immediately, so the Owner must paste the new URL into Telnyx.
  app.post('/api/extras/ring-token/rotate', exportLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const token = crypto.randomBytes(24).toString('hex');
    const sealed = seal(token);
    if (!sealed) {
      res.status(400).json({error: 'Set SECRETS_KEY on the server first.'});
      return;
    }
    await store.mutateWorkspace(ctx.workspace.organizationId, (w) => {
      w.secrets = {...(w.secrets ?? {}), ringToken: sealed};
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({organizationId: ctx.workspace.organizationId, token, legacy: false});
  });

  // ----- tools the Telnyx AI Assistant calls mid-conversation (authenticated by a per-organization token) -----
  // The AI assistant calls this when it cannot help: the caller gets a polite fallback from the assistant, and a callback
  // lead is created here (emergency keywords are still detected and alerted). Idempotent per conversation.
  // Token-authenticated server-to-server calls from the AI assistant: no cookies, so no CSRF risk, but cap them per business anyway
  // (a leaked tool token must not be able to flood the business with leads or SMS).
  const toolLimiter = createRateLimiter({
    name: 'tools',
    windowMs: 60_000,
    max: 120,
    key: (req) => `tool:${str(req.params.orgId, 80)}`,
    message: 'Too many tool calls. Please slow down.',
  });
  app.post('/api/tools/:orgId/callback-request', toolLimiter, async (req, res) => {
    const orgId = toolAuth(req, res);
    if (!orgId) return;
    if (!(await orgAllowed(orgId))) {
      res.status(402).json({error: BLOCKED_MESSAGE});
      return;
    }
    const phone = toE164(str(req.body?.phone, 30));
    if (!phone) {
      res.status(400).json({error: 'A valid callback phone number is required.'});
      return;
    }
    const conv = str(req.body?.conversationId, 100).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
    const reason = str(req.body?.reason, 300) || 'The caller needs a callback.';
    const name = str(req.body?.name, 80) || `Caller …${phone.slice(-4)}`;
    let found = false;
    let leadIdOut = '';
    let job: AlertJob | null = null;
    let evs: {type: 'lead_created' | 'emergency_detected'; data: unknown}[] = [];
    let snap: TenantWorkspace | null = null;
    await store.mutateWorkspace(orgId, (ws) => {
      found = true;
      job = null;
      evs = [];
      snap = ws;
      // Telnyx may retry a tool call. With a conversationId the lead id is stable. Without one, derive it from the phone and
      // reason plus the current hour, so a retry within the hour cannot create a second lead (and a second emergency alert).
      const dedupeKey = conv || `h${crypto.createHash('sha1').update(`${phone}|${reason}`).digest('hex').slice(0, 12)}-${Math.floor(Date.now() / 3_600_000)}`;
      const leadId = `${orgId}-lcb-${dedupeKey}`;
      leadIdOut = leadId;
      if (ws.leads.some((l) => l.id === leadId)) return; // already recorded for this conversation
      const hit = matchEmergency(`${reason} ${str(req.body?.details, 500)}`, ws.settings.emergencyRules.keywords);
      const urgency = hit ? ('Emergency' as const) : ('Normal' as const);
      const iso = nowIso();
      ws.leads.unshift({
        id: leadId, organizationId: orgId, name, phone, email: '', trade: 'Plumbing', serviceType: 'Callback Request',
        problemDescription: reason, zip: '', fullAddress: 'Address pending confirmation', urgency,
        preferredAppointment: 'Next Available', leadSource: 'AI Phone Receptionist', callDurationSec: 0,
        linkedCallId: conv ? `${orgId}-tx-${conv}` : undefined, createdAt: 'Just now', createdAtISO: iso, dayOffset: 0,
        status: urgency === 'Emergency' ? 'Qualified' : 'New', estimatedValue: 0,
        internalNotes: 'Callback requested: the AI receptionist could not complete this request. Please call the customer back.',
      });
      store.notify(ws, {
        type: urgency === 'Emergency' ? 'Urgent Lead' : 'New Lead',
        title: `Callback requested — ${name}`,
        body: reason.slice(0, 200),
        targetPath: `/app/leads/${leadId}`,
      });
      evs.push({type: 'lead_created', data: {id: leadId, name, phone, urgency, serviceType: 'Callback Request', summary: reason, source: 'AI Phone Receptionist'}});
      if (urgency === 'Emergency') evs.push({type: 'emergency_detected', data: {leadId, phone, reason: hit}});
      job = {kind: urgency === 'Emergency' ? 'emergency' : 'new-lead', leadId, name, phone, summary: `Callback requested: ${reason}`};
    });
    if (!found) {
      res.status(404).json({error: 'Unknown organization.'});
      return;
    }
    const w = snap as TenantWorkspace | null;
    if (w) for (const e of evs) emitEvent(w, e.type, e.data);
    const j = job as AlertJob | null;
    if (w && j) {
      void emailAlert(orgId, w, j).catch(() => {});
      const sms = j.kind === 'emergency' ? buildEmergencyAlert(w, phone, reason, leadIdOut) : null;
      if (sms && telnyxSmsConfigured()) void sendTelnyxSms(sms.to, sms.text);
    }
    res.json({ok: true, leadId: leadIdOut});
  });

  app.post('/api/tools/:orgId/missed-call', toolLimiter, async (req, res) => {
    const orgId = toolAuth(req, res);
    if (!orgId) return;
    if (!(await orgAllowed(orgId))) {
      res.status(402).json({error: BLOCKED_MESSAGE});
      return;
    }
    const ws = await store.peekWorkspace(orgId);
    if (!ws) {
      res.status(404).json({error: 'Unknown organization.'});
      return;
    }
    res.json(await missedCallTextBack(orgId, ws, str(req.body?.from, 30)));
  });

  app.post('/api/tools/:orgId/send-link', toolLimiter, async (req, res) => {
    const orgId = toolAuth(req, res);
    if (!orgId) return;
    if (!(await orgAllowed(orgId))) {
      res.status(402).json({error: BLOCKED_MESSAGE});
      return;
    }
    const ws = await store.peekWorkspace(orgId);
    if (!ws) {
      res.status(404).json({error: 'Unknown organization.'});
      return;
    }
    if (!planAllows(ws, 'smsActions')) {
      res.status(402).json({error: upgradeMessage('smsActions'), code: 'plan_required'});
      return;
    }
    const to = toE164(str(req.body?.to, 30));
    const kind = oneOf(req.body?.kind, ['booking', 'directions'] as const);
    if (!to || !kind) {
      res.status(400).json({error: 'A valid "to" number and kind (booking|directions) are required.'});
      return;
    }
    if (req.body?.consent !== true) {
      res.status(400).json({error: 'The caller must agree to receive a text before one is sent.'});
      return;
    }
    // The caller agreed on the call (consent === true above). Record it BEFORE sending; opt-outs and withdrawals still block.
    let consent = checkSmsConsent(ws, to, 'service');
    if (!consent.ok && consent.reason !== 'no-consent' && consent.reason !== 'purpose-not-covered') {
      res.status(403).json({error: consentErrorMessage(consent.reason)});
      return;
    }
    if (!consent.ok) {
      try {
        await store.mutateWorkspace(orgId, (cur) => {
          grantSmsConsent(cur, {phone: to, purposes: ['service'], source: 'phone_call', evidence: `Caller agreed on the call to receive a ${kind} link`, nowISO: nowIso()});
        });
      } catch (e) {
        console.error('[consent] could not record call consent:', e instanceof Error ? e.message : e);
        res.status(503).json({error: 'Could not record consent. Please try again.'});
        return;
      }
      consent = {ok: true, record: {phone: to, purposes: ['service'], source: 'phone_call', capturedAtISO: nowIso()}};
    }
    const consentRec = consent.record;
    const link = kind === 'booking' ? ws.extras?.bookingLink : ws.voiceAgent.address ? `https://maps.google.com/?q=${encodeURIComponent(ws.voiceAgent.address)}` : '';
    if (!link) {
      res.status(400).json({error: kind === 'booking' ? 'No approved booking link is configured.' : 'No business address is configured.'});
      return;
    }
    const footer = ws.settings.notificationPreferences.tcpaFooterText || 'Reply STOP to opt out.';
    const text = `${ws.voiceAgent.businessName}: ${kind === 'booking' ? 'Book your visit here' : 'Directions to our office'}: ${link} ${footer}`;
    if (!withinTextingHours(ws.settings.timezone)) {
      res.status(403).json({error: 'Texting is paused outside 8am–9pm business time.'});
      return;
    }
    const seen = await store.hit(`send-link:${orgId}:${to}:${kind}`, 24 * 60 * 60 * 1000);
    if (seen.count > 1) {
      res.status(429).json({error: 'This caller was already sent that link today.'});
      return;
    }
    const fuId = newId(`${orgId}-f`);
    try {
      await store.mutateWorkspace(orgId, (cur) => {
        // Queued in the same save as the follow-up record; the text goes out after it commits.
        if (!queueSms(cur, {dedupeKey: `sendlink:${to}:${kind}:${nowIso().slice(0, 10)}`, to, text, purpose: 'service', followUpId: fuId}).created) return;
        cur.followUps.unshift({
          id: fuId, organizationId: orgId, leadId: '', customerName: `Caller …${to.slice(-4)}`, phone: to, trade: 'Plumbing',
          triggerReason: kind === 'booking' ? 'Booking link sent during call' : 'Directions sent during call', messagePreview: text,
          consentOptIn: true, consentSource: consentRec.source, consentAtISO: consentRec.capturedAtISO, status: 'Pending', scheduledFor: 'Sending…',
        });
      });
    } catch (e) {
      console.error('[outbox] could not queue link text:', e instanceof Error ? e.message : e);
      res.status(503).json({error: 'Could not queue the text. Please try again.'});
      return;
    }
    await Promise.race([dispatchOutbox(orgId), sleep(4000)]).catch(() => {});
    res.status(200).json({ok: true, queued: true});
  });

  // ----- inbound SMS: STOP / START opt-out handling (Telnyx message.received) -----
  app.post('/api/webhooks/telnyx-sms/:orgId', webhookIpLimiter, async (req, res) => {
    const raw = (req as Request & {rawBody?: Buffer}).rawBody;
    if (!verifyTelnyxWebhook(raw, req.header('telnyx-signature-ed25519'), req.header('telnyx-timestamp'))) {
      res.status(401).json({error: 'Invalid webhook signature.'});
      return;
    }
    const data = isRecord(req.body?.data) ? req.body.data : {};
    const p = isRecord(data.payload) ? data.payload : {};
    const from = isRecord(p.from) ? toE164(str(p.from.phone_number, 30)) : '';
    const word = str(p.text, 40).trim().toUpperCase();
    const orgId = str(req.params.orgId, 80);
    if (data.event_type === 'message.received' && from && ORG_RE.test(orgId)) {
      const stop = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(word);
      const start = ['START', 'UNSTOP', 'YES'].includes(word);
      if (stop || start) {
        await store.mutateWorkspace(orgId, (ws) => {
          const list = new Set(ws.extras?.smsOptOut ?? []);
          if (stop) {
            list.add(from);
            revokeSmsConsent(ws, from, nowIso());
          } else {
            list.delete(from);
            restoreSmsConsent(ws, from);
          }
          ws.extras = {...(ws.extras ?? {}), smsOptOut: [...list].slice(-5000)};
        });
      }
    }
    res.json({received: true});
  });

  // ----- website knowledge import (preview, then explicit owner approval) -----
  app.post('/api/knowledge/preview', async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'knowledgeImport')) {
      res.status(402).json({error: upgradeMessage('knowledgeImport'), code: 'plan_required'});
      return;
    }
    const hit = await store.hit(`kb-import:${ctx.workspace.organizationId}`, 60 * 60 * 1000);
    if (hit.count > 10) {
      res.status(429).json({error: 'Too many imports. Try again in an hour.'});
      return;
    }
    try {
      res.json({preview: await previewWebsite(str(req.body?.url, 300))});
    } catch (e) {
      res.status(400).json({error: e instanceof Error ? e.message : 'Could not read that website.'});
    }
  });

  app.post('/api/knowledge/approve', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'knowledgeImport')) {
      res.status(402).json({error: upgradeMessage('knowledgeImport'), code: 'plan_required'});
      return;
    }
    const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []).map((l: unknown) => str(l, 240)).filter(Boolean).slice(0, 60);
    if (!lines.length) {
      res.status(400).json({error: 'Select at least one line to publish.'});
      return;
    }
    const src = str(req.body?.url, 200);
    const block = `\n\n[Imported from ${src} on ${new Date().toISOString().slice(0, 10)} — approved by owner]\n${lines.join('\n')}`;
    const merged = `${ctx.workspace.voiceAgent.aiKnowledgeNotes}${block}`;
    if (merged.length > 4000) {
      res.status(400).json({error: 'Knowledge notes are full (4,000 characters). Remove some text first.'});
      return;
    }
    ctx.workspace.voiceAgent = {...ctx.workspace.voiceAgent, aiKnowledgeNotes: merged};
    res.json({voiceAgent: ctx.workspace.voiceAgent});
  });

  // ----- Google Calendar -----
  app.get('/api/integrations/google/start', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'calendar')) {
      res.status(402).json({error: upgradeMessage('calendar'), code: 'plan_required'});
      return;
    }
    if (!gcalConfigured()) {
      res.status(400).json({error: 'Set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, APP_URL and SECRETS_KEY first.'});
      return;
    }
    const exp = Date.now() + 10 * 60_000;
    const payload = `${ctx.workspace.organizationId}.${exp}`;
    res.json({url: buildAuthUrl(`${payload}.${hmacHex(payload, 'gcal-state')}`)});
  });

  app.get('/api/integrations/google/callback', externalCallLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const [orgId, exp, sig] = str(req.query.state, 300).split('.');
    const expected = hmacHex(`${orgId}.${exp}`, 'gcal-state');
    if (!expected || !sig || !safeEqual(sig, expected) || Number(exp) < Date.now() || orgId !== ctx.workspace.organizationId) {
      res.status(400).send('This sign-in link is invalid or expired. Please start again from PlumbVoice.');
      return;
    }
    try {
      const {refreshToken} = await exchangeCode(str(req.query.code, 500));
      const sealed = refreshToken ? seal(refreshToken) : null;
      if (!sealed) throw new Error('Google did not return a refresh token. Remove PlumbVoice from your Google account permissions and try again.');
      await store.mutateWorkspace(orgId, (ws) => {
        ws.secrets = {...(ws.secrets ?? {}), googleRefreshToken: sealed};
        ws.extras = {...(ws.extras ?? {}), googleCalendar: {connected: true, calendarId: 'primary'}};
      });
      res.redirect('/app');
    } catch (e) {
      res.status(400).send(e instanceof Error ? e.message : 'Google connection failed.');
    }
  });

  app.post('/api/integrations/google/disconnect', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    const {googleRefreshToken: _drop, ...rest} = ctx.workspace.secrets ?? {};
    ctx.workspace.secrets = rest;
    ctx.workspace.extras = {...(ctx.workspace.extras ?? {}), googleCalendar: {connected: false, calendarId: 'primary'}};
    res.json({ok: true});
  });

  app.get('/api/calendar/availability', externalCallLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'calendar')) {
      res.status(402).json({error: upgradeMessage('calendar'), code: 'plan_required'});
      return;
    }
    const date = str(req.query.date, 10);
    if (!isValidDateISO(date)) {
      res.status(400).json({error: 'date (YYYY-MM-DD) is required.'});
      return;
    }
    const token = await googleToken(ctx.workspace);
    if (!token) {
      res.status(400).json({error: 'Google Calendar is not connected.'});
      return;
    }
    try {
      res.json({date, windows: await listFreeWindows(token, ctx.workspace.extras?.googleCalendar?.calendarId || 'primary', date, ctx.workspace.settings.timezone, ctx.workspace.settings.workingHours)});
    } catch (e) {
      res.status(502).json({error: e instanceof Error ? e.message : 'Google Calendar request failed.'});
    }
  });

  // ----- website chat widget (public, domain-allowlisted) -----
  const chatCors = (req: Request, res: Response, domains: string[]): boolean => {
    const origin = req.headers.origin;
    if (!originAllowed(origin, domains)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return true;
  };

  app.options('/api/public/chat/:orgId', (req, res) => {
    const id = str(req.params.orgId, 80);
    (ORG_RE.test(id) ? store.peekWorkspace(id) : Promise.resolve(null))
      .then((ws) => {
        if (!ws || !chatCors(req, res, ws.extras?.chatWidget?.allowedDomains ?? [])) res.status(403).end();
        else res.status(204).end();
      })
      .catch(() => res.status(500).end());
  });

  app.get('/api/public/chat/:orgId', publicReadLimiter, async (req, res) => {
    const orgId = str(req.params.orgId, 80);
    const ws = ORG_RE.test(orgId) ? await store.peekWorkspace(orgId) : null;
    const cw = ws?.extras?.chatWidget;
    if (!ws || !cw?.enabled || !chatCors(req, res, cw.allowedDomains)) {
      res.status(404).json({error: 'Chat is not available.'});
      return;
    }
    if (!accessFor(ws).allowed) {
      res.status(404).json({error: 'Chat is not available.'});
      return;
    }
    res.json({businessName: ws.voiceAgent.businessName, welcome: cw.welcome});
  });

  const CHAT_LIMITS = chatLimits();
  app.post('/api/public/chat/:orgId', async (req, res) => {
    // Emergency stop for the AI bill: set CHAT_DISABLED=true and redeploy / restart.
    if (process.env.CHAT_DISABLED === 'true') {
      res.status(503).json({error: 'Chat is temporarily unavailable. Please call the business directly.'});
      return;
    }
    const orgId = str(req.params.orgId, 80);
    const sessionId = str(req.body?.sessionId, 64);
    if (!ORG_RE.test(orgId) || !/^[A-Za-z0-9-]{8,64}$/.test(sessionId)) {
      res.status(400).json({error: 'A valid session id is required.'});
      return;
    }
    // Cheap checks first: validate the shape, then count against the limits BEFORE any database read or model call.
    const turns = prepareTurns(req.body?.messages, CHAT_LIMITS);
    if (!turns) {
      res.status(400).json({error: 'Send 1–40 messages, ending with the visitor’s message.'});
      return;
    }
    const who = {ip: clientIp(req), orgId, sessionId};
    const tooMany = (b: {scope: string; retryAfterSec: number}) => {
      console.warn(`[chat] rate limited (${b.scope}) org=${orgId}`);
      res.setHeader('Retry-After', String(b.retryAfterSec));
      res.status(429).json({error: 'Too many messages. Please try again later or call the business directly.'});
    };
    const ipBudget = await chatBudget((k, w) => store.hit(k, w), 'ip', who, CHAT_LIMITS);
    if (!ipBudget.ok) return tooMany(ipBudget);
    const ws = await store.peekWorkspace(orgId);
    const cw = ws?.extras?.chatWidget;
    if (!ws || !cw?.enabled || !chatCors(req, res, cw.allowedDomains)) {
      res.status(403).json({error: 'Chat is not available on this site.'});
      return;
    }
    if (!(await orgAllowed(orgId))) {
      res.status(503).json({error: 'Chat is temporarily unavailable. Please call the business directly.'});
      return;
    }
    const orgBudget = await chatBudget((k, w) => store.hit(k, w), 'org', who, CHAT_LIMITS);
    if (!orgBudget.ok) return tooMany(orgBudget);
    const result = await runAgent(turns, 'Website chat visitor (text chat)', ws.voiceAgent, ws.settings);
    const x = result.extracted;
    const complete = Boolean(x.name && x.phone && (x.address || x.zip) && x.serviceType);
    // The AI could not help but has a name + number and flagged "Callback requested": still capture a lead for a callback.
    const callbackReady = !complete && Boolean(x.name && x.phone && /^callback requested/i.test(x.escalationReason ?? ''));
    let alert: {to: string; text: string} | null = null;
    let events: {type: 'lead_created' | 'call_completed' | 'emergency_detected'; data: unknown}[] = [];
    let jobs: AlertJob[] = [];
    if (complete || callbackReady) {
      await store.mutateWorkspace(orgId, (cur) => {
        alert = null;
        events = [];
        jobs = [];
        const callId = `${orgId}-chat-${sessionId}`;
        const service = (x.serviceType as string | null) || 'Callback Request';
        const callerText = turns.filter((t) => t.speaker === 'caller').map((t) => t.text).join(' ');
        const transcript = turns.map((t, i) => ({id: `${callId}-t-${i}`, speaker: t.speaker, timestampSec: i * 15, text: t.text}));
        const existing = cur.calls.find((c) => c.id === callId);
        if (existing) {
          existing.transcript = transcript;
          return;
        }
        const urgency = x.isEmergency ? ('Emergency' as const) : (x.urgency ?? 'Normal');
        const trade = x.trade ?? 'Plumbing';
        const leadId = newId(`${orgId}-l`);
        const iso = nowIso();
        const {tags, nextSteps} = tagCall({urgency, durationSec: turns.length * 15, callerText});
        const loc = planAllows(cur, 'multiLocation') ? routeLocation(cur, x.zip ?? '', callerText) : null;
        cur.leads.unshift({
          id: leadId, organizationId: orgId, name: x.name as string, locationId: loc?.id, phone: x.phone as string, email: '', trade,
          serviceType: service, problemDescription: x.escalationReason || service,
          zip: x.zip ?? '', fullAddress: x.address || 'Address pending confirmation', urgency,
          preferredAppointment: x.preferredTime || 'Next Available', leadSource: 'Website Chat',
          callDurationSec: turns.length * 15, linkedCallId: callId, createdAt: 'Just now', createdAtISO: iso, dayOffset: 0,
          status: urgency === 'Emergency' ? 'Qualified' : 'New', estimatedValue: 0,
          internalNotes: `Created from the website chat widget.${loc ? ` Routed to ${loc.name}.` : ''}`,
        });
        cur.calls.unshift({
          id: callId, organizationId: orgId, callerName: x.name as string, callerPhone: x.phone as string, locationId: loc?.id,
          address: x.address ?? '', zip: x.zip ?? '', trade, serviceRequested: service, answeredBy: 'AI',
          status: 'Answered', urgency, durationSec: turns.length * 15, pickupRings: 0, estimatedValue: 0,
          createdAt: 'Just now', createdAtISO: iso, dayOffset: 0, hourOfDay: new Date().getHours(),
          aiSummary: `Website chat: ${service}`, recordingAvailable: false, linkedLeadId: leadId, waveform: [],
          transcript, tags, nextSteps, channel: 'chat', language: detectLanguage(callerText),
        });
        store.notify(cur, {
          type: urgency === 'Emergency' ? 'Urgent Lead' : 'New Lead',
          title: `${urgency} website chat — ${x.name}`,
          body: `${service} (${trade}) from the website chat widget.`,
          targetPath: `/app/leads/${leadId}`,
        });
        events.push({type: 'lead_created', data: {id: leadId, name: x.name, phone: x.phone, trade, urgency, serviceType: service, zip: x.zip, address: x.address, source: 'Website Chat'}});
        if (urgency === 'Emergency') jobs.push({kind: 'emergency', leadId, name: x.name as string, phone: x.phone as string, summary: `${service} (website chat)`});
        else if (callbackReady || cur.settings.notificationPreferences.smsOnNewLead) jobs.push({kind: 'new-lead', leadId, name: x.name as string, phone: x.phone as string, summary: `${service} (website chat)`});
        if (urgency === 'Emergency') {
          events.push({type: 'emergency_detected', data: {leadId, name: x.name, phone: x.phone, reason: x.escalationReason}});
          alert = buildEmergencyAlert(cur, x.phone as string, service, leadId, loc);
        }
      });
      for (const ev of events) emitEvent(ws, ev.type, ev.data);
      if (jobs.length) void Promise.all(jobs.map((j) => emailAlert(orgId, ws, j))).catch(() => {});
      const pending = alert as {to: string; text: string} | null;
      if (pending && telnyxSmsConfigured()) void sendTelnyxSms(pending.to, pending.text);
    }
    res.json({replyText: result.replyText, leadCreated: complete || callbackReady});
  });

  // ----- data export, duplicate merge -----
  app.get('/api/export/json', exportLimiter, (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx || !requireStepUp(ctx, res)) return;
    if (!planAllows(ctx.workspace, 'jsonExport')) {
      res.status(402).json({error: upgradeMessage('jsonExport'), code: 'plan_required'});
      return;
    }
    const ws = store.view(ctx.workspace) as unknown as Record<string, unknown>;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="plumbvoice-export.json"');
    res.send(JSON.stringify({exportedAt: nowIso(), format: 'plumbvoice-export-v1', workspace: ws}, null, 2));
  });

  const digits10 = (v: string) => v.replace(/\D/g, '').slice(-10);

  app.post('/api/leads/merge', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'leadMerge')) {
      res.status(402).json({error: upgradeMessage('leadMerge'), code: 'plan_required'});
      return;
    }
    const keepId = str(req.body?.keepId, 80);
    const mergeId = str(req.body?.mergeId, 80);
    const ws = ctx.workspace;
    const keep = ws.leads.find((l) => l.id === keepId);
    const dupe = ws.leads.find((l) => l.id === mergeId);
    if (!keep || !dupe || keepId === mergeId) {
      res.status(400).json({error: 'Choose two different leads to merge.'});
      return;
    }
    // Only merge leads that look like the same customer.
    if (!digits10(keep.phone) || digits10(keep.phone) !== digits10(dupe.phone)) {
      res.status(400).json({error: 'These leads have different phone numbers, so they are not merged.'});
      return;
    }
    const fill = <K extends 'email' | 'fullAddress' | 'zip' | 'serviceType' | 'problemDescription'>(k: K) => {
      const empty = !keep[k] || String(keep[k]).startsWith('Address pending');
      if (empty && dupe[k]) keep[k] = dupe[k];
    };
    (['email', 'fullAddress', 'zip', 'serviceType', 'problemDescription'] as const).forEach(fill);
    keep.estimatedValue = Math.max(keep.estimatedValue, dupe.estimatedValue);
    if (!keep.linkedCallId && dupe.linkedCallId) keep.linkedCallId = dupe.linkedCallId;
    if (!keep.assignedMemberId && dupe.assignedMemberId) keep.assignedMemberId = dupe.assignedMemberId;
    if (!keep.reviewRequestedAtISO && dupe.reviewRequestedAtISO) keep.reviewRequestedAtISO = dupe.reviewRequestedAtISO;
    if (dupe.urgency === 'Emergency') keep.urgency = 'Emergency';
    const note = `Merged duplicate lead from ${dupe.createdAt || dupe.createdAtISO || 'earlier'} (${dupe.leadSource}): ${dupe.problemDescription}${dupe.internalNotes ? ` | Notes: ${dupe.internalNotes}` : ''}`;
    keep.internalNotes = str(`${keep.internalNotes ? `${keep.internalNotes}\n` : ''}${note}`, 4000);
    for (const a of ws.appointments) if (a.linkedLeadId === dupe.id) a.linkedLeadId = keep.id;
    for (const f of ws.followUps) if (f.leadId === dupe.id) f.leadId = keep.id;
    for (const q of ws.quotes ?? []) if (q.leadId === dupe.id) q.leadId = keep.id;
    for (const c of ws.calls) if ((c as {linkedLeadId?: string}).linkedLeadId === dupe.id) (c as {linkedLeadId?: string}).linkedLeadId = keep.id;
    ws.leads = ws.leads.filter((l) => l.id !== dupe.id);
    res.json({lead: keep, removedId: dupe.id});
  });

  // ----- quotes (estimates the customer approves from a private link) -----
  const quoteView = (q: QuoteItem) => ({...q, expired: q.status === 'Open' && Date.parse(q.validUntilISO) < Date.now()});

  app.post('/api/leads/:id/quotes', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'quotes')) {
      res.status(402).json({error: upgradeMessage('quotes'), code: 'plan_required'});
      return;
    }
    const lead = ctx.workspace.leads.find((l) => l.id === req.params.id);
    if (!lead) {
      res.status(404).json({error: 'Lead not found'});
      return;
    }
    const b = isRecord(req.body) ? req.body : {};
    const title = str(b.title, 120);
    const rawItems = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
    const items: QuoteItem['items'] = [];
    for (const it of rawItems) {
      if (!isRecord(it)) continue;
      const description = str(it.description, 160);
      const amount = num(it.amount, 0, 1_000_000);
      if (description && amount !== undefined) items.push({description, amount: Math.round(amount * 100) / 100});
    }
    if (!title || items.length === 0) {
      res.status(400).json({error: 'Add a title and at least one line with a description and amount.'});
      return;
    }
    const validDays = num(b.validDays, 1, 90) ?? 14;
    const now = Date.now();
    const total = Math.round(items.reduce((t, i) => t + i.amount, 0) * 100) / 100;
    const quote: QuoteItem = {
      id: crypto.randomBytes(16).toString('hex'), organizationId: ctx.workspace.organizationId, leadId: lead.id,
      customerName: lead.name, customerPhone: lead.phone, title, items, total, notes: str(b.notes, 1000), status: 'Open',
      createdAtISO: new Date(now).toISOString(), validUntilISO: new Date(now + Math.floor(validDays) * 86_400_000).toISOString(),
    };
    ctx.workspace.quotes = [quote, ...(ctx.workspace.quotes ?? [])]; // capped centrally by store.enforceLimits
    res.status(201).json({quote: quoteView(quote)});
  });

  app.post('/api/quotes/:id/void', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const q = (ctx.workspace.quotes ?? []).find((x) => x.id === req.params.id);
    if (!q) {
      res.status(404).json({error: 'Quote not found'});
      return;
    }
    if (q.status === 'Accepted') {
      res.status(400).json({error: 'This quote was already accepted and cannot be voided.'});
      return;
    }
    q.status = 'Voided';
    res.json({quote: quoteView(q)});
  });

  app.post('/api/quotes/:id/send', smsSendLimiter, async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'quotes')) {
      res.status(402).json({error: upgradeMessage('quotes'), code: 'plan_required'});
      return;
    }
    const ws = ctx.workspace;
    const q = (ws.quotes ?? []).find((x) => x.id === req.params.id);
    if (!q || q.status !== 'Open') {
      res.status(400).json({error: 'Only an open quote can be sent.'});
      return;
    }
    const base = baseUrl(req);
    const to = toE164(q.customerPhone);
    const fail = (error: string) => res.status(400).json({error});
    if (!base) return fail('APP_URL is not set on the server.');
    if (!accessFor(ws).allowed) return fail(BLOCKED_MESSAGE);
    if (!telnyxSmsConfigured()) return fail('Text messaging is not set up on the server yet. Copy the link and send it yourself.');
    if (!to) return fail('This customer has no valid mobile number.');
    const quoteConsent = checkSmsConsent(ws, to, 'service');
    if (!quoteConsent.ok) return fail(consentErrorMessage(quoteConsent.reason));
    if (!withinTextingHours(ws.settings.timezone)) return fail('Texts are only sent between 8am and 9pm business time.');
    const first = q.customerName.trim().split(/\s+/)[0] || 'there';
    const footer = ws.settings.notificationPreferences.tcpaFooterText || 'Reply STOP to opt out.';
    const text = `${ws.voiceAgent.businessName}: Hi ${first}, your estimate for ${q.title} is $${q.total.toFixed(2)}. Review and approve it here: ${base}/quote/${ws.organizationId}/${q.id} ${footer}`.slice(0, 600);
    // Queued with the save; "link sent" appears once the text is actually delivered. A retried request (same Idempotency-Key) queues once.
    queueSms(ws, {dedupeKey: `quote:${q.id}:${ctx.idemKey ?? nowIso().slice(0, 16)}`, to, text, purpose: 'service', after: {kind: 'quote', id: q.id}});
    res.json({quote: quoteView(q), queued: true});
  });

  const quoteLimiter = createRateLimiter({name: 'quote', windowMs: 60 * 60_000, max: 30, key: (req) => clientIp(req), message: 'Too many requests. Please try again later.'});

  app.get('/api/public/quote/:orgId/:id', quoteLimiter, async (req, res) => {
    const orgId = str(req.params.orgId, 80);
    const ws = ORG_RE.test(orgId) ? await store.peekWorkspace(orgId) : null;
    const q = ws?.quotes?.find((x) => x.id === str(req.params.id, 64));
    if (!ws || !q || q.status === 'Voided') {
      res.status(404).json({error: 'This quote link is not valid.'});
      return;
    }
    res.json({
      businessName: ws.voiceAgent.businessName, phone: ws.voiceAgent.businessPhone, customerName: q.customerName, title: q.title,
      items: q.items, total: q.total, notes: q.notes, status: q.status, validUntilISO: q.validUntilISO,
      expired: q.status === 'Open' && Date.parse(q.validUntilISO) < Date.now(), respondedByName: q.respondedByName ?? '',
    });
  });

  app.post('/api/public/quote/:orgId/:id', quoteLimiter, async (req, res) => {
    const orgId = str(req.params.orgId, 80);
    const id = str(req.params.id, 64);
    const action = oneOf(req.body?.action, ['accept', 'decline'] as const);
    const name = str(req.body?.name, 80);
    if (!ORG_RE.test(orgId) || !action) {
      res.status(400).json({error: 'Invalid request.'});
      return;
    }
    if (action === 'accept' && name.length < 2) {
      res.status(400).json({error: 'Please type your full name to approve this quote.'});
      return;
    }
    let result: 'ok' | 'missing' | 'closed' | 'expired' = 'missing';
    await store.mutateWorkspace(orgId, (ws) => {
      const q = ws.quotes?.find((x) => x.id === id);
      if (!q || q.status === 'Voided') return;
      if (q.status !== 'Open') {
        result = 'closed';
        return;
      }
      if (Date.parse(q.validUntilISO) < Date.now()) {
        result = 'expired';
        return;
      }
      q.status = action === 'accept' ? 'Accepted' : 'Declined';
      q.respondedAtISO = nowIso();
      q.respondedByName = name || q.customerName;
      const lead = ws.leads.find((l) => l.id === q.leadId);
      if (lead && action === 'accept') {
        lead.estimatedValue = q.total;
        lead.internalNotes = str(`${lead.internalNotes ? `${lead.internalNotes}\n` : ''}Quote “${q.title}” ($${q.total.toFixed(2)}) approved online by ${q.respondedByName}.`, 4000);
      }
      store.notify(ws, {
        type: 'System',
        title: `Quote ${action === 'accept' ? 'approved' : 'declined'} — ${q.customerName}`,
        body: `${q.title}: $${q.total.toFixed(2)}${action === 'accept' ? `. Approved by ${q.respondedByName}. Call to schedule the work.` : '.'}`,
        targetPath: `/app/leads/${q.leadId}`,
      });
      result = 'ok';
    });
    if (result === 'missing') res.status(404).json({error: 'This quote link is not valid.'});
    else if (result === 'closed') res.status(409).json({error: 'This quote was already answered.'});
    else if (result === 'expired') res.status(410).json({error: 'This quote has expired. Please contact the business for a new one.'});
    else res.json({ok: true, status: action === 'accept' ? 'Accepted' : 'Declined'});
  });

  // ----- ring the owner first, then the AI (Telnyx TeXML) -----
  // Telnyx number -> TeXML application whose Voice URL is /api/telnyx/texml/<orgId>/<secret>.
  //   1. voice URL: <Dial> the owner's phone for N seconds (caller hears ringing).
  //   2. "answered" status callback marks the call as picked up by the owner.
  //   3. "after" action URL: owner answered -> hang up; no answer / busy / failed -> connect the caller to the AI assistant.
  const xmlEsc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sendXml = (res: Response, body: string) => res.status(200).type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
  const SORRY = '<Say>Sorry, we cannot take your call right now. Please try again later.</Say><Hangup/>';
  // The raw bytes are kept so the Telnyx signature (if present / required) can be verified.
  const texmlParsers = express.urlencoded({
    extended: false,
    limit: '30kb',
    verify: (req, _res, buf) => {
      (req as Request & {rawBody?: Buffer}).rawBody = Buffer.from(buf);
    },
  });

  const texmlOrg = async (req: Request) => {
    const raw = (req as Request & {rawBody?: Buffer}).rawBody;
    if (!texmlSignatureOk(raw, req.header('telnyx-signature-ed25519'), req.header('telnyx-timestamp'), texmlSignatureRequired(process.env))) {
      console.warn('[texml] request refused: Telnyx signature missing or invalid. If your TeXML application does not sign requests, set TEXML_REQUIRE_SIGNATURE=false (the secret URL then stays the only protection).');
      return null;
    }
    const orgId = str(req.params.orgId, 80);
    const given = String(req.params.token ?? '');
    const ws = ORG_RE.test(orgId) ? await store.peekWorkspace(orgId) : null;
    const expected = ws ? ringTokenOf(ws).token : null;
    if (!ws || !expected || !safeEqual(given, expected)) return null;
    return {orgId, ws, token: given};
  };
  const aiConnect = (assistantId: string) =>
    /^assistant-[A-Za-z0-9-]{8,80}$/.test(assistantId) ? `<Connect><AIAssistant id="${xmlEsc(assistantId)}"></AIAssistant></Connect>` : SORRY;

  app.post('/api/telnyx/texml/:orgId/:token', webhookIpLimiter, texmlParsers, async (req, res) => {
    const org = await texmlOrg(req);
    if (!org) {
      res.status(401).type('text/plain').send('Invalid URL');
      return;
    }
    const rf = org.ws.extras?.ringFirst;
    const allowed = accessFor(org.ws).allowed;
    const owner = rf ? toE164(rf.ownerPhone) : '';
    if (!rf?.enabled || !owner || !planAllows(org.ws, 'ringFirst')) {
      // Ring-first is off: behave exactly like a number pointed straight at the AI (or refuse if the plan is inactive).
      sendXml(res, allowed ? aiConnect(rf?.assistantId ?? '') : SORRY);
      return;
    }
    const base = baseUrl(req);
    if (!base) {
      console.error('[texml] APP_URL is not set; cannot build callback URLs');
      sendXml(res, allowed ? aiConnect(rf.assistantId) : SORRY);
      return;
    }
    const callSid = str(req.body?.CallSid, 120);
    const root = `${base}/api/telnyx/texml/${org.orgId}/${org.token}`;
    const q = `?c=${encodeURIComponent(callSid)}`;
    sendXml(
      res,
      `<Dial timeout="${rf.seconds}" answerOnBridge="true" action="${xmlEsc(`${root}/after${q}`)}" method="POST">` +
        `<Number statusCallback="${xmlEsc(`${root}/answered${q}`)}" statusCallbackEvent="answered" statusCallbackMethod="POST">${xmlEsc(owner)}</Number></Dial>`
    );
  });

  app.post('/api/telnyx/texml/:orgId/:token/answered', webhookIpLimiter, texmlParsers, async (req, res) => {
    const org = await texmlOrg(req);
    if (!org) {
      res.status(401).end();
      return;
    }
    const c = str(req.query.c, 120);
    if (c) await store.hit(`ring-ans:${c}`, 15 * 60_000).catch(() => {});
    res.status(200).end();
  });

  app.post('/api/telnyx/texml/:orgId/:token/after', webhookIpLimiter, texmlParsers, async (req, res) => {
    const org = await texmlOrg(req);
    if (!org) {
      res.status(401).type('text/plain').send('Invalid URL');
      return;
    }
    const c = str(req.query.c, 120);
    // The answered callback created the counter first, so a count above 1 here means the owner picked up.
    const mark = c ? await store.hit(`ring-ans:${c}`, 15 * 60_000).catch(() => ({count: 1})) : {count: 1};
    const status = str(req.body?.DialCallStatus, 30).toLowerCase();
    const seconds = Number(req.body?.DialCallDuration ?? 0);
    const answered = mark.count > 1 || (status === 'completed' && seconds > 0);
    if (answered) {
      sendXml(res, '<Hangup/>');
      return;
    }
    if (!accessFor(org.ws).allowed) {
      sendXml(res, SORRY);
      return;
    }
    sendXml(res, aiConnect(org.ws.extras?.ringFirst?.assistantId ?? ''));
  });

  // ----- audit log -----
  app.get('/api/audit-log', async (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'auditLog')) {
      res.status(402).json({error: upgradeMessage('auditLog'), code: 'plan_required'});
      return;
    }
    res.json({log: await store.listAuditLog(ctx.workspace.organizationId, 200)});
  });

  // ----- maintenance reminders (a text to a past customer on a future date) -----
  app.post('/api/leads/:id/reminders', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    if (!planAllows(ctx.workspace, 'reminders')) {
      res.status(402).json({error: upgradeMessage('reminders'), code: 'plan_required'});
      return;
    }
    const ws = ctx.workspace;
    const lead = ws.leads.find((l) => l.id === req.params.id);
    if (!lead) {
      res.status(404).json({error: 'Lead not found'});
      return;
    }
    const phone = toE164(lead.phone);
    if (!phone) {
      res.status(400).json({error: 'This lead has no valid mobile number.'});
      return;
    }
    const reminderConsent = checkSmsConsent(ws, phone, 'maintenance_reminder');
    if (!reminderConsent.ok) {
      res.status(400).json({error: consentErrorMessage(reminderConsent.reason)});
      return;
    }
    const b = isRecord(req.body) ? req.body : {};
    const months = num(b.months, 1, 36);
    let due = '';
    if (months !== undefined) {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() + Math.floor(months));
      due = d.toISOString().slice(0, 10);
    } else if (typeof b.dueDateISO === 'string' && isValidDateISO(b.dueDateISO)) {
      due = b.dueDateISO;
    }
    const today = nowIso().slice(0, 10);
    const max = new Date(Date.now() + 3 * 366 * 86_400_000).toISOString().slice(0, 10);
    if (!due || due < today || due > max) {
      res.status(400).json({error: 'Choose a date from today up to 3 years ahead.'});
      return;
    }
    ws.reminders ??= [];
    // keep the list small: drop finished reminders older than 90 days
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    ws.reminders = ws.reminders.filter((r) => r.status === 'Scheduled' || r.dueDateISO >= cutoff);
    if (ws.reminders.filter((r) => r.status === 'Scheduled').length >= 500 || ws.reminders.filter((r) => r.leadId === lead.id && r.status === 'Scheduled').length >= 5) {
      res.status(400).json({error: 'Too many scheduled reminders (max 5 per customer).'});
      return;
    }
    const first = lead.name.trim().split(/\s+/)[0] || 'there';
    const biz = ws.voiceAgent.businessName;
    const message =
      str(b.message, 320) ||
      `Hi ${first}, this is ${biz}. It has been a while since your ${lead.serviceType.toLowerCase()} visit. Want us to do a quick check-up? Call us${ws.voiceAgent.businessPhone ? ` at ${ws.voiceAgent.businessPhone}` : ''} to book.`;
    const item: ReminderItem = {
      id: newId(`${ws.organizationId}-r`), organizationId: ws.organizationId, leadId: lead.id, customerName: lead.name, phone,
      message, dueDateISO: due, status: 'Scheduled', attempts: 0, createdAtISO: nowIso(),
    };
    ws.reminders.unshift(item);
    res.status(201).json({reminder: item});
  });

  app.post('/api/reminders/:id/cancel', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher']);
    if (!ctx) return;
    const r = (ctx.workspace.reminders ?? []).find((x) => x.id === req.params.id);
    if (!r) {
      res.status(404).json({error: 'Reminder not found'});
      return;
    }
    if (r.status !== 'Scheduled') {
      res.status(400).json({error: 'Only a scheduled reminder can be cancelled.'});
      return;
    }
    r.status = 'Cancelled';
    res.json({reminder: r});
  });

  /**
   * Background sender. Runs on every server, so each reminder is claimed with a shared counter first
   * (only the server that gets count 1 sends it). Respects: active subscription, STOP list, 8am-9pm business time.
   * A failed send is retried on the next run, up to 3 attempts, then marked Failed.
   */
  const runReminders = async (): Promise<{checked: number; skipped?: string}> => {
    if (!telnyxSmsConfigured()) return {checked: 0, skipped: 'SMS is not configured'};
    const today = nowIso().slice(0, 10);
    let ids: string[] = [];
    try {
      ids = await store.listWorkspaceIdsWithDueReminders(today);
    } catch (e) {
      console.error('[reminders] lookup failed:', e instanceof Error ? e.message : e);
      return {checked: 0, skipped: 'lookup failed'};
    }
    for (const orgId of ids) {
      const ws = await store.peekWorkspace(orgId);
      if (!ws) continue;
      const allowed = accessFor(ws).allowed;
      const quiet = !withinTextingHours(ws.settings.timezone);
      const footer = ws.settings.notificationPreferences.tcpaFooterText || 'Reply STOP to opt out.';
      for (const r of (ws.reminders ?? []).filter((x) => x.status === 'Scheduled' && x.dueDateISO <= today)) {
        let outcome: ReminderItem['status'] | 'retry' | null = null;
        let note = '';
        let remConsent: {source: NonNullable<FollowUpItem['consentSource']>; capturedAtISO: string} | undefined;
        // Re-checked at send time: a STOP or withdrawal after scheduling must stop the text.
        const remCheck = checkSmsConsent(ws, r.phone, 'maintenance_reminder');
        if (!allowed) {
          outcome = 'Skipped';
          note = 'Subscription inactive';
        } else if (!remCheck.ok) {
          outcome = 'Skipped';
          note = remCheck.reason === 'opted-out' ? 'Customer opted out' : remCheck.reason === 'revoked' ? 'Consent withdrawn' : 'No text consent on file';
        } else if (quiet) {
          continue; // try again in a later run, inside texting hours
        } else {
          remConsent = {source: remCheck.record.source, capturedAtISO: remCheck.record.capturedAtISO};
          const claim = await store.hit(`reminder:${r.id}:${r.attempts}`, 7 * 86_400_000).catch(() => ({count: 1}));
          if (claim.count > 1) continue; // another server is handling it
          const sent = await sendTelnyxSms(r.phone, `${r.message} ${footer}`.slice(0, 600));
          if (sent.ok) outcome = 'Sent';
          else {
            console.error(`[reminders] send failed for ${r.id}: ${sent.error}`);
            outcome = r.attempts + 1 >= 3 ? 'Failed' : 'retry';
          }
        }
        await store
          .mutateWorkspace(orgId, (cur) => {
            const x = cur.reminders?.find((y) => y.id === r.id);
            if (!x || x.status !== 'Scheduled') return;
            if (outcome === 'retry') {
              x.attempts += 1;
              return;
            }
            x.status = outcome as ReminderItem['status'];
            if (note) x.note = note;
            if (outcome === 'Sent') {
              x.sentAtISO = nowIso();
              cur.followUps.unshift({
                id: newId(`${cur.organizationId}-f`), organizationId: cur.organizationId, leadId: x.leadId, customerName: x.customerName,
                phone: x.phone, trade: cur.leads.find((l) => l.id === x.leadId)?.trade ?? 'Plumbing', triggerReason: 'Maintenance Reminder',
                messagePreview: x.message, consentOptIn: true, consentSource: remConsent?.source, consentAtISO: remConsent?.capturedAtISO,
                status: 'Sent', scheduledFor: 'Sent just now',
              });
            }
          })
          .catch((e) => console.error('[reminders] could not record result:', e instanceof Error ? e.message : e));
      }
    }
    return {checked: ids.length};
  };
  // Always-on servers (VPS, Render, Railway, Docker) run the timer themselves. Serverless hosting (Vercel) freezes
  // the process between requests, so there a scheduler must call /api/cron/reminders instead (see below).
  if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
    setTimeout(() => void runReminders(), 60_000).unref();
    setInterval(() => void runReminders(), 30 * 60_000).unref();
    // Sweeper: retries queued texts / webhooks / calendar writes that were not finished right after their commit.
    setInterval(() => void runOutbox(), 60_000).unref();
  }

  // Called by a scheduler (Vercel Cron, cron-job.org, GitHub Actions…) with `Authorization: Bearer <CRON_SECRET>`.
  // Safe to call as often as you like: each reminder is claimed once, and texts only go out 8am-9pm business time.
  const cronHandler = async (req: Request, res: Response) => {
    const secret = (process.env.CRON_SECRET || '').trim();
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-cron-secret'] || '').trim();
    if (secret.length < 16) {
      res.status(503).json({error: 'Set CRON_SECRET (16+ characters) to enable the scheduler endpoint.'});
      return;
    }
    if (!given || !safeEqual(given, secret)) {
      res.status(401).json({error: 'Unauthorized'});
      return;
    }
    try {
      res.json({ok: true, ...(await runReminders()), outboxProcessed: await runOutbox()});
    } catch (e) {
      console.error('[cron] reminders failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ok: false, error: 'Reminder run failed'});
    }
  };
  app.get('/api/cron/reminders', webhookIpLimiter, cronHandler);
  app.post('/api/cron/reminders', webhookIpLimiter, cronHandler);

  // ----- public customer booking page (/book/<organizationId>) -----
  // A request, not a confirmed slot: it becomes a lead (source "Booking Page") and the owner confirms the time.
  const BOOKING_TIMES = ['Morning', 'Afternoon', 'Evening', 'Anytime'] as const;

  app.get('/api/public/book/:orgId', publicReadLimiter, async (req, res) => {
    const orgId = str(req.params.orgId, 80);
    const ws = ORG_RE.test(orgId) ? await store.peekWorkspace(orgId) : null;
    const bp = ws?.extras?.bookingPage;
    if (!ws || !bp?.enabled || !accessFor(ws).allowed || !planAllows(ws, 'bookingPage')) {
      res.status(404).json({error: 'Online booking is not available.'});
      return;
    }
    res.json({businessName: ws.voiceAgent.businessName, intro: bp.intro, phone: ws.voiceAgent.businessPhone});
  });

  app.post('/api/public/book/:orgId', async (req, res) => {
    const orgId = str(req.params.orgId, 80);
    const ws = ORG_RE.test(orgId) ? await store.peekWorkspace(orgId) : null;
    const bp = ws?.extras?.bookingPage;
    if (!ws || !bp?.enabled || !(await orgAllowed(orgId)) || !planAllows(ws, 'bookingPage')) {
      res.status(404).json({error: 'Online booking is not available.'});
      return;
    }
    const b = isRecord(req.body) ? req.body : {};
    if (typeof b.website === 'string' && b.website.trim()) {
      res.status(201).json({ok: true}); // honeypot field filled by a bot: pretend success, store nothing
      return;
    }
    const ip = clientIp(req);
    const [a, o] = await Promise.all([store.hit(`book-ip:${ip}`, 60 * 60_000), store.hit(`book-org:${orgId}`, 24 * 60 * 60_000)]);
    if (a.count > 5 || o.count > 100) {
      res.status(429).json({error: 'Too many requests. Please call us instead.'});
      return;
    }
    const name = str(b.name, 80);
    const phone = toE164(str(b.phone, 30));
    const email = str(b.email, 120);
    const serviceType = str(b.serviceType, 100);
    const details = str(b.details, 600);
    const address = str(b.address, 200);
    const zip = /^\d{5}$/.test(str(b.zip, 10)) ? str(b.zip, 10) : '';
    const day = typeof b.preferredDay === 'string' ? b.preferredDay : '';
    const time = oneOf(b.preferredTime, BOOKING_TIMES) ?? 'Anytime';
    if (!name || !phone || !serviceType) {
      res.status(400).json({error: 'Please enter your name, a valid phone number and what you need.'});
      return;
    }
    if (email && !isEmail(email)) {
      res.status(400).json({error: 'That email address does not look right.'});
      return;
    }
    if (b.consent !== true) {
      res.status(400).json({error: 'Please tick the box so we can contact you about this request.'});
      return;
    }
    const today = nowIso().slice(0, 10);
    const limit = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    if (day && (!isValidDateISO(day) || day < today || day > limit)) {
      res.status(400).json({error: 'Please choose a day within the next 60 days.'});
      return;
    }
    let emergency = false;
    let job: AlertJob | null = null;
    let alert: {to: string; text: string} | null = null;
    const evs: {type: 'lead_created' | 'emergency_detected'; data: unknown}[] = [];
    let snap: TenantWorkspace | null = null;
    await store.mutateWorkspace(orgId, (cur) => {
      job = null;
      alert = null;
      evs.length = 0;
      snap = cur;
      const iso = nowIso();
      // The customer ticked the consent box on this page: store it (timestamp, source, purpose) before anything is texted.
      // The checkbox covers replies about this request only. Review and maintenance texts need their own consent.
      grantSmsConsent(cur, {phone, purposes: ['service'], source: 'booking_page', evidence: 'booking-page checkbox v1', nowISO: iso});
      const dupe = cur.leads.some((l) => l.leadSource === 'Booking Page' && l.phone === phone && l.createdAtISO && Date.parse(iso) - Date.parse(l.createdAtISO) < 10 * 60_000);
      if (dupe) return;
      const hit = matchEmergency(`${serviceType} ${details}`, cur.settings.emergencyRules.keywords);
      emergency = Boolean(hit);
      const urgency = emergency ? ('Emergency' as const) : ('Normal' as const);
      const trade = cur.voiceAgent.businessType === 'Electrical' ? ('Electrical' as const) : ('Plumbing' as const);
      const leadId = newId(`${orgId}-l`);
      const loc = planAllows(cur, 'multiLocation') ? routeLocation(cur, zip, details) : null;
      cur.leads.unshift({
        id: leadId, organizationId: orgId, name, phone, email, trade, serviceType, locationId: loc?.id,
        problemDescription: details || serviceType, zip, fullAddress: address || 'Address pending confirmation', urgency,
        preferredAppointment: `${day || 'Flexible day'} · ${time}`, leadSource: 'Booking Page', callDurationSec: 0,
        createdAt: 'Just now', createdAtISO: iso, dayOffset: 0, status: emergency ? 'Qualified' : 'New', estimatedValue: 0,
        internalNotes: `Requested from the online booking page. Confirm the time with the customer.${loc ? ` Routed to ${loc.name}.` : ''}`,
      });
      store.notify(cur, {
        type: emergency ? 'Urgent Lead' : 'New Lead',
        title: `${emergency ? 'Urgent booking request' : 'Booking request'} — ${name}`,
        body: `${serviceType} (${trade}), wants ${day || 'a flexible day'} · ${time}.`,
        targetPath: `/app/leads/${leadId}`,
      });
      evs.push({type: 'lead_created', data: {id: leadId, name, phone, trade, urgency, serviceType, zip, address, source: 'Booking Page'}});
      job = {kind: emergency ? 'emergency' : 'new-lead', leadId, name, phone, summary: `${serviceType} (booking page, ${day || 'flexible day'} ${time})`};
      if (emergency) {
        evs.push({type: 'emergency_detected', data: {leadId, name, phone, reason: hit}});
        alert = buildEmergencyAlert(cur, phone, serviceType, leadId, loc);
      }
    });
    if (snap) for (const ev of evs) emitEvent(snap, ev.type, ev.data);
    if (job && snap) void emailAlert(orgId, snap, job).catch(() => {});
    const pending = alert as {to: string; text: string} | null;
    if (pending && telnyxSmsConfigured()) void sendTelnyxSms(pending.to, pending.text);
    res.status(201).json({ok: true, emergency});
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({error: 'Not found'});
  });

  // ----- frontend -----
  if (!isProd) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({server: {middlewareMode: true}, appType: 'spa'});
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      // Only real page routes get the app shell. A missing API route or asset must be a 404, not HTML with status 200
      // (otherwise a stale tab asking for an old hashed file gets index.html and fails with a confusing MIME error).
      if (req.path.startsWith('/api/') || path.extname(req.path)) {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // JSON parse errors and anything unexpected -> clean JSON, no stack traces.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      console.error('[server] error after response was sent:', err);
      return;
    }
    const status = (err as {status?: number}).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({error: 'Invalid request.'});
      return;
    }
    console.error('[server] unhandled error:', err);
    res.status(500).json({error: 'Something went wrong. Please try again.'});
  });

  if (isProd) {
    const report = productionConfigReport(process.env);
    for (const w of report.warnings) console.warn(`[config] ${w}`);
    for (const f of report.fatal) console.error(`[config] ${f}`);
    if (report.fatal.length && process.env.ALLOW_INSECURE_PROD !== 'true') {
      console.error('[config] Refusing to start with an insecure production configuration (set ALLOW_INSECURE_PROD=true only for local testing).');
      process.exit(1);
    }
  }

  // Serverless (Vercel): hand the app to the function handler instead of listening on a port.
  if (process.env.VERCEL) return app;

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`PlumbVoice AI listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
    if (!geminiConfigured()) console.log('[agent] No GEMINI_API_KEY: Test Agent uses the rule-based fallback.');
    if (!mailConfigured()) {
      if (isProd && !autoVerifyAllowed()) console.error('[mail] SENDGRID_API_KEY/MAIL_FROM not set: sign-up is DISABLED in production until e-mail is configured.');
      else console.warn('[mail] SENDGRID_API_KEY/MAIL_FROM not set: new accounts are auto-verified and emails are not delivered.');
    }
    if (isProd && !process.env.APP_URL) {
      console.error('[config] APP_URL is not set. Verification and password-reset links cannot be generated in production.');
    }
    if (store.backend === 'memory') {
      console.warn('[storage] Using local storage (single server only). Set DATABASE_URL to run several servers together.');
    }
  });

  // Keep-alive slightly above typical load-balancer idle timeouts to avoid spurious 502s.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 60_000;

  // Graceful shutdown: stop accepting connections, let in-flight requests finish, then close storage.
  const shutdown = (code = 0) => {
    server.close(() => {
      void store.close().finally(() => process.exit(code));
    });
    setTimeout(() => process.exit(code), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  installProcessGuards(() => shutdown(1));
  server.on('error', (err) => {
    console.error('[server] listen error:', err);
    process.exit(1);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start PlumbVoice AI server:', err);
    process.exit(1);
  });
}
