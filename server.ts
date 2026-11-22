import 'dotenv/config';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type {Request, Response, NextFunction} from 'express';
import {store, newId, PLAN_MINUTES, STEP_UP_WINDOW_MS, DEVICE_TTL_MS, UserFacingError, emailIdentityKey, normalizeEmail} from './server/store.ts';
import {geminiConfigured, runAgent} from './server/agent.ts';
import type {ChatTurn} from './server/agent.ts';
import {actionCodeEmail, loginCodeEmail, mailConfigured, resetEmail, sendMail, verificationEmail} from './server/mailer.ts';
import {clientIp, createRateLimiter} from './server/rateLimit.ts';
import {installProcessGuards, makeAsyncSafe, sleep} from './server/safe.ts';
import {bool, buildPatch, csvCell, isEmail, isRecord, isValidDateISO, num, oneOf, pick, str} from './server/validate.ts';
import type {
  AppointmentItem,
  CallItem,
  FollowUpItem,
  IntegrationStatusItem,
  LeadItem,
  PlanTier,
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
const codesRequired = () => mailConfigured() || process.env.LOGIN_CODES === 'always';

/** Sensitive changes on a device that wasn't saved need a recent emailed code. */
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
  const hasStripe = Boolean(process.env.STRIPE_SECRET_KEY);
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
      connected: false,
      summary:
        'Simulation mode: System Numbers are placeholders and test calls are simulated. Connect a telephony provider to receive real calls.',
      envRequired: ['TELEPHONY_PROVIDER'],
      setupInstructions:
        'Real PSTN calls need a provider such as Twilio or Telnyx with a signed webhook. Until then, "Test call" only logs a simulated call.',
    },
    {
      id: 'system-sms-alerts',
      name: 'Dispatch SMS & Missed-Call Text-Back',
      category: 'Messaging',
      connected: false,
      summary: 'No SMS provider is connected, so no text messages are sent yet.',
      envRequired: ['SMS_PROVIDER'],
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
      summary: hasGoogleCal
        ? 'OAuth client is configured but calendar sync is not implemented yet.'
        : 'Not connected. Calendar sync is not implemented yet.',
      envRequired: ['GOOGLE_CALENDAR_CLIENT_ID'],
      setupInstructions: 'Planned: Google OAuth to push confirmed service windows to crew calendars.',
    },
    {
      id: 'stripe-billing',
      name: 'Stripe Subscription Billing',
      category: 'Billing',
      connected: false,
      summary: hasStripe
        ? 'Stripe key is present but checkout is not implemented yet; plan changes are recorded locally only.'
        : 'Not connected. Plan changes are recorded locally and nobody is charged.',
      envRequired: ['STRIPE_SECRET_KEY'],
      setupInstructions: 'Planned: Stripe Checkout with Price IDs for Starter ($149), Professional ($299), Business ($549).',
    },
  ];
}

const nowIso = () => new Date().toISOString();

// ---------- app ----------

async function initStorageWithRetry() {
  // The database may still be starting (e.g. all containers booting together), so retry before giving up.
  const attempts = 10;
  for (let attempt = 1; ; attempt++) {
    try {
      await store.init();
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      const wait = Math.min(attempt * 2000, 10_000);
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
  app.use(express.json({limit: '256kb'}));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  // Block cross-origin state-changing requests, and persist data after any successful write.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try {
          const host = new URL(origin).host;
          ok = host === req.get('host') || (process.env.APP_URL ? host === new URL(process.env.APP_URL).host : false);
        } catch {
          ok = false;
        }
        if (!ok) {
          res.status(403).json({error: 'Cross-origin request blocked.'});
          return;
        }
      }
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
      };
      res.locals.ctx = ctx;

      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const sendJson = res.json.bind(res);
        res.json = ((body?: unknown) => {
          store.enforceLimits(ctx.workspace);
          if (res.statusCode >= 400 || JSON.stringify(ctx.workspace) === ctx.snapshot) {
            return sendJson(body);
          }
          store
            .saveWorkspace(ctx.workspace.organizationId, ctx.workspace, ctx.version)
            .then((newVersion) => {
              if (res.headersSent) return; // client disconnected or another path already replied
              if (newVersion === null) {
                // Another server/session saved first; nothing was written, so a retry is safe.
                res.status(409);
                sendJson({error: 'Your workspace changed in another session. Retrying…', retryable: true});
              } else {
                ctx.version = newVersion;
                ctx.snapshot = JSON.stringify(ctx.workspace);
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

  // ----- SEO -----
  const publicPaths = [
    '/', '/how-it-works', '/features', '/plumbing-answering-service', '/electrician-answering-service',
    '/pricing', '/about', '/contact', '/blog',
    '/cities/houston-tx', '/cities/austin-tx', '/cities/phoenix-az', '/cities/denver-co',
  ];
  app.get('/robots.txt', (req, res) => {
    const base = baseUrl(req) || `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(
      ['User-agent: *', 'Allow: /', 'Disallow: /app/', 'Disallow: /api/', `Sitemap: ${base}/sitemap.xml`].join('\n')
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
    res.json({ok: true, service: 'PlumbVoice AI', instance: os.hostname(), storage: store.backend, timestamp: nowIso()});
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
    if (!requireAuth(req, res)) return;
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

  app.post('/api/auth/verify-email', async (req, res) => {
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
    res.json({user: ctx.session, workspace: store.view(ctx.workspace), integrations: getIntegrationStatuses()});
  });

  app.get('/api/dashboard', (req, res) => {
    const ctx = requireAuth(req, res);
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
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    res.json({calls: store.view(ctx.workspace).calls});
  });

  app.get('/api/calls/:id', (req, res) => {
    const ctx = requireAuth(req, res);
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

  app.get('/api/leads/export/csv', (req, res) => {
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
    res.json({leads: store.view(ctx.workspace).leads});
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
    const lead: LeadItem = {
      id: newId(`${ws.organizationId}-l`),
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
    res.status(201).json({lead});
  });

  app.patch('/api/leads/:id', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Technician']);
    if (!ctx) return;
    const lead = ctx.workspace.leads.find((l) => l.id === req.params.id);
    if (!lead) {
      res.status(404).json({error: 'Lead not found'});
      return;
    }
    let patch = leadPatch(req.body, ctx.workspace);
    if (ctx.session.role === 'Technician') {
      // Technicians may only progress status and add notes.
      patch = pick(patch, ['status', 'internalNotes']);
    }
    Object.assign(lead, patch);
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

  app.post('/api/appointments', (req, res) => {
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
    const appt: AppointmentItem = {
      id: newId(`${ws.organizationId}-a`),
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
    ws.appointments.unshift(appt);
    res.status(201).json({appointment: appt});
  });

  app.patch('/api/appointments/:id', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner', 'Dispatcher', 'Technician']);
    if (!ctx) return;
    const appt = ctx.workspace.appointments.find((a) => a.id === req.params.id);
    if (!appt) {
      res.status(404).json({error: 'Appointment not found'});
      return;
    }
    let p = buildPatch<AppointmentItem>(req.body, apptRules(ctx.workspace));
    if (ctx.session.role === 'Technician') p = pick(p, ['status']);
    Object.assign(appt, p);
    res.json({appointment: appt});
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
      next.emergencyRules = {
        ...cur.emergencyRules,
        ...(Array.isArray(r.keywords)
          ? {keywords: r.keywords.map((k) => str(k, 60)).filter(Boolean).slice(0, 50)}
          : {}),
        ...(typeof r.escalateToPhone === 'string' ? {escalateToPhone: str(r.escalateToPhone, 30)} : {}),
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
  app.post('/api/team', (req, res) => {
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

  // ----- billing (plan choice only; usage and invoices are server-owned) -----
  app.patch('/api/billing', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx || !requireStepUp(ctx, res)) return;
    const b = ctx.workspace.billing;
    const plan = oneOf(req.body?.plan, PLANS) as PlanTier | undefined;
    const cycle = oneOf(req.body?.billingCycle, ['monthly', 'annual'] as const);
    if (plan) {
      b.plan = plan;
      b.minutesIncluded = PLAN_MINUTES[plan];
    }
    if (cycle) b.billingCycle = cycle;
    res.json({billing: b});
  });

  app.post('/api/onboarding/complete', (req, res) => {
    const ctx = requireAuth(req, res, ['Owner']);
    if (!ctx) return;
    ctx.workspace.onboardingCompleted = true;
    res.json({ok: true, onboardingCompleted: true});
  });

  // ----- voice agent test conversation (Gemini, with rule-based fallback) -----
  app.post('/api/agent/converse', agentLimiter, agentOrgLimiter, agentIpLimiter, async (req, res) => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
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
    const result = await runAgent(turns, scenario, ctx.workspace.voiceAgent, ctx.workspace.settings);
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
    app.get('*', (_req, res) => {
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

  // Serverless (Vercel): hand the app to the function handler instead of listening on a port.
  if (process.env.VERCEL) return app;

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`PlumbVoice AI listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
    if (!geminiConfigured()) console.log('[agent] No GEMINI_API_KEY: Test Agent uses the rule-based fallback.');
    if (!mailConfigured()) {
      console.warn('[mail] SENDGRID_API_KEY/MAIL_FROM not set: new accounts are auto-verified and emails are not delivered.');
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
