import crypto from 'node:crypto';
import {promisify} from 'node:util';
import type {
  BillingData,
  BusinessSettingsData,
  NotificationItem,
  PhoneSetupConfig,
  PlanTier,
  TeamMember,
  TenantWorkspace,
  UserSession,
  VoiceAgentConfig,
} from '../src/types/plumbvoice.ts';
import {createStorage} from './storage.ts';
import {stripeConfigured} from './stripe.ts';
import {accessFor} from './access.ts';
import type {CodeRecord, ContactMessage, Storage, StoredUser, TokenRecord, TrustedDevice, WebhookLogRecord, AuditLogRecord} from './storage.ts';

export type {ContactMessage, StoredUser};

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number
) => Promise<Buffer>;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
export const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;
/** Price (USD) of one extra AI minute beyond the plan. Override with OVERAGE_RATE_USD. */
export const OVERAGE_RATE = (() => {
  const n = Number(process.env.OVERAGE_RATE_USD);
  return Number.isFinite(n) && n > 0 && n < 10 ? Math.round(n * 100) / 100 : 0.35;
})();

export const PLAN_MINUTES: Record<PlanTier, number> = {Starter: 250, Professional: 1000, Business: 2000};

// ---------- helpers ----------

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

/**
 * Trims a newest-first list to `max`. Test records are dropped first (oldest first), so a flood of
 * test data can never push real customer records out; real ones go only if still over the cap.
 */
const isTestRecord = (item: object): boolean => (item as {isTest?: boolean}).isTest === true;

function trimKeepingReal<T extends object>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  let excess = items.length - max;
  const dropTest = new Set<number>();
  for (let i = items.length - 1; i >= 0 && excess > 0; i--) {
    if (isTestRecord(items[i])) {
      dropTest.add(i);
      excess--;
    }
  }
  const kept = items.filter((_, i) => !dropTest.has(i));
  return excess > 0 ? kept.slice(0, kept.length - excess) : kept;
}

/** Errors whose message is safe to show to the end user. Anything else is logged and hidden. */
export class UserFacingError extends Error {}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Identity key: Gmail ignores dots and +tags, so those variants map to one account. */
export function emailIdentityKey(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replaceAll('.', '');
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function resolveTimezone(setting: string | undefined): string {
  const candidate = (setting || '').split(' ')[0];
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: candidate});
    return candidate;
  } catch {
    return 'America/Chicago';
  }
}

function dayParts(date: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24};
}

/** Derive display label, day offset, and hour-of-day from a stored ISO timestamp. */
export function timeFields(iso: string, tz: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const a = dayParts(date, tz);
  const b = dayParts(now, tz);
  const dayOffset = Math.max(
    0,
    Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
  );
  const time = new Intl.DateTimeFormat('en-US', {timeZone: tz, hour: 'numeric', minute: '2-digit'}).format(date);
  const mins = Math.floor((now.getTime() - date.getTime()) / 60_000);
  const label =
    mins < 1
      ? 'Just now'
      : mins < 60
        ? `${mins}m ago`
        : dayOffset === 0
          ? `Today, ${time}`
          : dayOffset === 1
            ? `Yesterday, ${time}`
            : `${dayOffset} days ago, ${time}`;
  return {createdAt: label, dayOffset, hourOfDay: a.h};
}

/** Simulated numbers only ever use the 555-01XX block that is reserved for fiction, so they can never ring a real person. */
function randomPhone(areaCode: string): string {
  return `(${areaCode}) 555-01${String(crypto.randomInt(0, 100)).padStart(2, '0')}`;
}

function createInitialWorkspace(
  organizationId: string,
  businessName: string,
  ownerName: string,
  ownerEmail: string,
  businessPhone: string,
  plan: PlanTier
): TenantWorkspace {
  const areaDigits = businessPhone.replace(/\D/g, '').slice(-10).slice(0, 3);
  const areaCode = /^[2-9]\d{2}$/.test(areaDigits) ? areaDigits : '512';

  const voiceAgent: VoiceAgentConfig = {
    agentName: 'Nora',
    businessName,
    businessType: 'Plumbing & Electrical',
    businessPhone,
    address: '',
    serviceAreas: [],
    workingHoursSummary: 'Mon–Fri 7:00 AM – 6:00 PM · Sat 8:00 AM – 2:00 PM',
    afterHoursAnswering: true,
    ringTimeoutSec: 20,
    greetingMessage: `Thank you for calling ${businessName}. This is Nora, our automated dispatch assistant. Are you calling about an urgent plumbing or electrical emergency, or would you like to schedule a service visit?`,
    voiceId: 'us-warm-female',
    speakingSpeed: 1.0,
    accent: 'American English (Neutral)',
    emergencyInstructions:
      'If the caller reports active flooding, burst pipes, gas odors, burning smells, sparking outlets, or exposed live wires: instruct them to stay safe, turn off the water shutoff or keep clear of the panel if safe, do NOT attempt dangerous repairs, and flag as Emergency for immediate on-call technician escalation.',
    aiKnowledgeNotes:
      'Residential and light commercial plumbing and electrical service. Never quote binding fixed prices over the phone without an on-site inspection.',
  };

  const phoneSetup: PhoneSetupConfig = {
    businessPhone,
    systemNumber: randomPhone(areaCode),
    systemNumberAreaCode: areaCode,
    systemNumberType: 'Local DID',
    systemNumberStatus: 'Active',
    systemNumberProvisionedAt: 'Reserved at signup (simulated)',
    ringTimeoutSec: 20,
    afterHoursForwarding: true,
    carrier: 'AT&T',
    forwardingVerified: false,
  };

  const settings: BusinessSettingsData = {
    businessName,
    licenseNumber: '',
    dispatchEmail: ownerEmail,
    timezone: 'America/Chicago (CST)',
    workingHours: [
      {day: 'Monday', enabled: true, open: '07:00', close: '18:00'},
      {day: 'Tuesday', enabled: true, open: '07:00', close: '18:00'},
      {day: 'Wednesday', enabled: true, open: '07:00', close: '18:00'},
      {day: 'Thursday', enabled: true, open: '07:00', close: '18:00'},
      {day: 'Friday', enabled: true, open: '07:00', close: '18:00'},
      {day: 'Saturday', enabled: true, open: '08:00', close: '14:00'},
      {day: 'Sunday', enabled: false, open: '09:00', close: '14:00'},
    ],
    holidayAutoAfterHours: true,
    emergencyRules: {
      keywords: [
        'burst pipe',
        'water everywhere',
        'flooding',
        'gas smell',
        'sparking',
        'burning smell',
        'exposed wire',
        'main breaker',
        'sewer backup',
      ],
      escalateToPhone: businessPhone,
      requireSafeShutoffGuidance: true,
      smsNotifyOwnerImmediately: true,
    },
    notificationPreferences: {
      smsOnNewLead: true,
      smsOnEmergency: true,
      emailDailyDigest: true,
      missedCallTextBackEnabled: true,
      tcpaFooterText: `Reply STOP to opt out of SMS updates from ${businessName}.`,
    },
  };

  const team: TeamMember[] = [
    {
      id: `${organizationId}-m1`,
      organizationId,
      name: ownerName,
      email: ownerEmail,
      phone: businessPhone,
      role: 'Owner',
      tradeSpecialty: 'Both',
      truckCode: 'HQ-01',
      status: 'Active',
      onCall: true,
    },
  ];

  const trialEnds = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const billing: BillingData = {
    plan,
    billingCycle: 'monthly',
    minutesUsed: 0,
    minutesIncluded: PLAN_MINUTES[plan],
    nextInvoiceDate: `${trialEnds} (trial ends)`,
    paymentMethodLast4: '',
    trialStartedAtISO: new Date().toISOString(),
    invoices: [],
  };

  return {
    organizationId,
    calls: [],
    leads: [],
    appointments: [],
    followUps: [],
    notifications: [],
    team,
    voiceAgent,
    phoneSetup,
    settings,
    billing,
    onboardingCompleted: false,
  };
}

// ---------- store ----------

const RECORD_LIMIT_TITLE = 'Record limit reached';
export const LIMITS = {calls: 1000, leads: 2000, appointments: 1000, followUps: 2000, quotes: 500, team: 100} as const;

/** True while another team member may be added. */
export const teamHasRoom = (ws: Pick<TenantWorkspace, 'team'>): boolean => ws.team.length < LIMITS.team;

export interface LoadedContext {
  user: StoredUser;
  session: UserSession;
  workspace: TenantWorkspace;
  version: number;
  deviceTrusted: boolean;
  stepUpUntil: number;
}

/**
 * Stateless service layer. All durable state goes through `Storage`, so many server processes
 * can run side by side against the same backend (Postgres) without sharing memory.
 */
export class PlumbVoiceStore {
  private storage!: Storage;
  private purgeTimer: NodeJS.Timeout | null = null;

  constructor(storage?: Storage) {
    if (storage) this.storage = storage;
  }

  async init(storage?: Storage) {
    this.storage = storage ?? this.storage ?? (await createStorage());
    await this.storage.init();
    this.purgeTimer = setInterval(() => void this.storage.purgeExpired().catch(() => {}), 10 * 60_000);
    this.purgeTimer.unref();
  }

  async close() {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    await this.storage.close();
  }

  get backend() {
    return this.storage.kind;
  }

  ping() {
    return this.storage.ping();
  }

  hit(key: string, windowMs: number) {
    return this.storage.hit(key, windowMs);
  }

  addContact(msg: ContactMessage) {
    return this.storage.addContactMessage(msg);
  }

  addWebhookLog(organizationId: string, item: WebhookLogRecord) {
    return this.storage.addWebhookLog(organizationId, item);
  }

  addAuditLog(organizationId: string, item: AuditLogRecord) {
    return this.storage.addAuditLog(organizationId, item);
  }

  listAuditLog(organizationId: string, limit = 200) {
    return this.storage.listAuditLog(organizationId, limit);
  }

  listWorkspaceIdsWithDueReminders(todayISO: string) {
    return this.storage.listWorkspaceIdsWithDueReminders(todayISO);
  }

  listWorkspaceIdsWithDueOutbox(nowISO: string) {
    return this.storage.listWorkspaceIdsWithDueOutbox(nowISO);
  }

  listWebhookLog(organizationId: string, limit = 50) {
    return this.storage.listWebhookLog(organizationId, limit);
  }

  // --- workspaces ---

  /**
   * The single door every workspace write goes through (request saves AND background mutations: Telnyx webhooks, public
   * booking/chat, tool callbacks, the outbox). Limits are enforced here, so no write path can forget them.
   */
  saveWorkspace(organizationId: string, ws: TenantWorkspace, expectedVersion: number) {
    this.enforceLimits(ws);
    return this.storage.saveWorkspace(organizationId, ws, expectedVersion);
  }

  /**
   * Keeps a single workspace document from growing without bound. Newest records are kept.
   * The owner gets one unread notice per kind of record (calls, leads, appointments, follow-ups, quotes) when REAL records
   * were removed. Dropping only Test Agent records is silent. Team size is a hard cap checked when adding a member
   * (see `teamHasRoom`); members are never removed here.
   */
  enforceLimits(ws: TenantWorkspace) {
    const trim = <T extends object>(label: string, items: T[], max: number): T[] => {
      if (items.length <= max) return items;
      const kept = trimKeepingReal(items, max);
      const realLost = items.filter((i) => !isTestRecord(i)).length - kept.filter((i) => !isTestRecord(i)).length;
      if (realLost > 0) {
        console.warn(`[limits] ${ws.organizationId}: ${label} limit reached (${max}); removed ${realLost} oldest.`);
        const title = `${RECORD_LIMIT_TITLE}: ${label}`;
        if (!ws.notifications.some((n) => n.title === title && !n.read)) {
          this.notify(ws, {type: 'System', title, body: `Only the newest ${max} ${label} are kept, so the oldest were removed. Download your data (Integrations > Download all my data) to keep older records.`, targetPath: '/app/integrations'});
        }
      }
      return kept;
    };
    ws.calls = trim('calls', ws.calls, LIMITS.calls);
    ws.leads = trim('leads', ws.leads, LIMITS.leads);
    ws.appointments = trim('appointments', ws.appointments, LIMITS.appointments);
    ws.followUps = trim('follow-ups', ws.followUps, LIMITS.followUps); // public text-backs could otherwise grow this forever
    if (ws.quotes) ws.quotes = trim('quotes', ws.quotes, LIMITS.quotes);
    if (ws.notifications.length > 200) ws.notifications.length = 200;
    purgeExpiredRecordings(ws);
  }

  /** Read-only snapshot of a workspace (used by public, unauthenticated endpoints). */
  async peekWorkspace(organizationId: string): Promise<TenantWorkspace | null> {
    return (await this.storage.getWorkspace(organizationId))?.ws ?? null;
  }

  /** Read-modify-write with retry for server-initiated changes (not tied to one request). */
  async mutateWorkspace(organizationId: string, fn: (ws: TenantWorkspace) => void) {
    for (let attempt = 0; attempt < 15; attempt++) {
      const cur = await this.storage.getWorkspace(organizationId);
      if (!cur) return;
      fn(cur.ws);
      if ((await this.saveWorkspace(organizationId, cur.ws, cur.version)) !== null) return;
      // Lost the version race: wait a short, randomised, growing time so competing writers stop colliding in lockstep.
      await new Promise((r) => setTimeout(r, Math.random() * Math.min(200, 5 * 2 ** attempt)));
    }
    throw new Error('Could not save workspace after several attempts.');
  }

  /** Copy of the workspace with relative-time fields recomputed from stored ISO timestamps. */
  view(ws: TenantWorkspace): TenantWorkspace {
    const tz = resolveTimezone(ws.settings.timezone);
    const now = new Date();
    const decorate = <T extends {createdAtISO?: string}>(item: T): T => {
      if (!item.createdAtISO) return item;
      const f = timeFields(item.createdAtISO, tz, now);
      return f ? {...item, ...f} : item;
    };
    const {secrets: _secrets, outbox: _outbox, ...publicWs} = ws; // server-only secrets and queued actions never reach the browser
    return {
      ...publicWs,
      billing: {...ws.billing, paymentsEnabled: stripeConfigured(), access: accessFor(ws), overageMinutes: Math.max(0, ws.billing.minutesUsed - ws.billing.minutesIncluded), overageRate: OVERAGE_RATE},
      // The provider's (temporary, signed) recording URL stays on the server; the browser plays /api/calls/:id/recording.
      calls: ws.calls.map((c) => {
        const {recordingUrl: _url, ...rest} = decorate(c);
        return rest;
      }),
      leads: ws.leads.map(decorate),
      notifications: ws.notifications.map((n) => {
        if (!n.createdAtISO) return n;
        const f = timeFields(n.createdAtISO, tz, now);
        return f ? {...n, createdAt: f.createdAt} : n;
      }),
    };
  }

  notify(
    ws: TenantWorkspace,
    n: Omit<NotificationItem, 'id' | 'organizationId' | 'createdAt' | 'createdAtISO' | 'read'>
  ) {
    ws.notifications.unshift({
      ...n,
      id: newId(`${ws.organizationId}-n`),
      organizationId: ws.organizationId,
      createdAt: 'Just now',
      createdAtISO: new Date().toISOString(),
      read: false,
    });
    if (ws.notifications.length > 200) ws.notifications.length = 200;
  }

  // --- users & sessions ---

  private toSession(user: StoredUser, ws: TenantWorkspace | undefined, deviceTrusted = false): UserSession {
    return {
      userId: user.id,
      organizationId: user.organizationId,
      name: user.name,
      email: user.email,
      role: user.role,
      onboardingCompleted: ws?.onboardingCompleted ?? false,
      twoFactorEnabled: user.twoFactorEnabled,
      emailVerified: user.emailVerified,
      deviceTrusted,
    };
  }

  getUserById(id: string) {
    return this.storage.getUserById(id);
  }

  getUserByEmail(email: string) {
    return this.storage.getUserByEmailKey(emailIdentityKey(normalizeEmail(email)));
  }

  /** Creates a login session. `stepUpUntil` lets an untrusted device do sensitive actions right after a code check. */
  async startSession(userId: string, opts: {stepUpUntil?: number} = {}): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await this.storage.putSession(sha256(token), {
      userId,
      expiresAt: Date.now() + SESSION_TTL_MS,
      stepUpUntil: opts.stepUpUntil,
    });
    return token;
  }

  // --- trusted devices ("Remember this device") ---

  isDeviceTrusted(user: StoredUser, deviceToken: string | undefined): boolean {
    if (!deviceToken) return false;
    const h = sha256(deviceToken);
    const now = Date.now();
    return (user.trustedDevices ?? []).some((d) => d.hash === h && d.expiresAt > now);
  }

  /** Remembers a browser for 30 days. Returns the cookie value to hand to the browser. */
  async trustDevice(userId: string, existingToken: string | undefined, label: string): Promise<string> {
    const user = await this.storage.getUserById(userId);
    const token = existingToken && existingToken.length === 64 ? existingToken : crypto.randomBytes(32).toString('hex');
    if (!user) return token;
    const now = Date.now();
    const h = sha256(token);
    const kept = (user.trustedDevices ?? []).filter((d) => d.expiresAt > now && d.hash !== h);
    const entry: TrustedDevice = {hash: h, label: label.slice(0, 120), expiresAt: now + DEVICE_TTL_MS};
    user.trustedDevices = [...kept, entry].slice(-10);
    await this.storage.updateUser(user);
    return token;
  }

  /** Forgets every remembered device and signs out all other sessions. */
  async forgetDevices(userId: string, keepSessionToken?: string) {
    const user = await this.storage.getUserById(userId);
    if (user) {
      user.trustedDevices = [];
      await this.storage.updateUser(user);
    }
    await this.storage.deleteUserSessions(userId, keepSessionToken ? sha256(keepSessionToken) : undefined);
  }

  // --- emailed one-time codes ---

  /** Creates a 6-digit code (valid 10 minutes, 5 guesses). The plain code is only returned to be emailed. */
  async issueCode(userId: string, purpose: CodeRecord['purpose'], remember = false): Promise<{id: string; code: string}> {
    const id = crypto.randomBytes(16).toString('hex');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await this.storage.putCode(id, {
      userId,
      purpose,
      codeHash: sha256(`${id}:${code}`),
      attempts: 0,
      expiresAt: Date.now() + CODE_TTL_MS,
      remember,
    });
    return {id, code};
  }

  /** Checks a code. Wrong guesses are counted; the code is consumed exactly once even across servers. */
  async checkCode(
    id: string,
    code: string,
    purpose: CodeRecord['purpose'],
    expectedUserId?: string
  ): Promise<{userId: string; remember: boolean}> {
    const fail = new UserFacingError('That code is incorrect or has expired.');
    const rec = await this.storage.bumpCode(id);
    if (!rec || rec.purpose !== purpose || (expectedUserId && rec.userId !== expectedUserId)) throw fail;
    if (rec.attempts > CODE_MAX_ATTEMPTS) {
      await this.storage.deleteCode(id);
      throw new UserFacingError('Too many wrong attempts. Please request a new code.');
    }
    const given = Buffer.from(sha256(`${id}:${code.trim()}`), 'hex');
    const real = Buffer.from(rec.codeHash, 'hex');
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) throw fail;
    if (!(await this.storage.deleteCode(id))) throw fail; // another request already used it
    return {userId: rec.userId, remember: rec.remember === true};
  }

  /** Opens a window in which an untrusted-device session may perform sensitive actions. */
  markStepUp(sessionToken: string) {
    return this.storage.setSessionStepUp(sha256(sessionToken), Date.now() + STEP_UP_WINDOW_MS);
  }

  /** Resolves a session token to the user and their workspace from shared storage. */
  async loadContext(token: string | undefined, deviceToken?: string): Promise<LoadedContext | null> {
    if (!token) return null;
    const rec = await this.storage.getSession(sha256(token));
    if (!rec) return null;
    const user = await this.storage.getUserById(rec.userId);
    if (!user) return null;
    const w = await this.storage.getWorkspace(user.organizationId);
    if (!w) return null;
    const deviceTrusted = this.isDeviceTrusted(user, deviceToken);
    return {
      user,
      session: this.toSession(user, w.ws, deviceTrusted),
      workspace: w.ws,
      version: w.version,
      deviceTrusted,
      stepUpUntil: rec.stepUpUntil ?? 0,
    };
  }

  async getSessionUser(token: string | undefined): Promise<UserSession | null> {
    return (await this.loadContext(token))?.session ?? null;
  }

  destroySession(token: string | undefined) {
    return token ? this.storage.deleteSession(sha256(token)) : Promise.resolve();
  }

  async registerAccount(input: {
    name: string;
    email: string;
    password: string;
    businessName: string;
    businessPhone: string;
    plan: PlanTier;
    /** True when no verification email can be sent (mail not configured), so accounts aren't locked out. */
    emailVerified?: boolean;
  }): Promise<{token: string; user: UserSession; stored: StoredUser}> {
    const email = normalizeEmail(input.email);
    const emailKey = emailIdentityKey(email);
    if (await this.storage.getUserByEmailKey(emailKey)) {
      throw new UserFacingError('An account with this email already exists.');
    }
    const organizationId = newId('org');
    const user: StoredUser = {
      id: newId('user'),
      organizationId,
      name: input.name,
      email,
      emailKey,
      passwordHash: await hashPassword(input.password),
      role: 'Owner',
      twoFactorEnabled: false,
      emailVerified: input.emailVerified ?? false,
      knownDevices: [],
      trustedDevices: [],
      createdAt: new Date().toISOString(),
    };
    const ws = createInitialWorkspace(
      organizationId,
      input.businessName || `${input.name} Services`,
      user.name,
      user.email,
      input.businessPhone,
      input.plan
    );
    // The UNIQUE(email_key) constraint makes this safe even if two servers race on the same email.
    if (!(await this.storage.createAccount(user, ws))) {
      throw new UserFacingError('An account with this email already exists.');
    }
    const token = await this.startSession(user.id);
    return {token, user: this.toSession(user, ws), stored: user};
  }

  /** Checks email + password only. Creating a session is a separate step (it may need a code first). */
  async verifyCredentials(email: string, password: string): Promise<StoredUser> {
    const user = await this.getUserByEmail(email);
    if (!user) {
      // Burn comparable CPU so response time doesn't reveal whether the email exists.
      dummyHash ??= hashPassword('dummy-password');
      await verifyPassword(password, await dummyHash);
      throw new UserFacingError('Invalid email or password.');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new UserFacingError('Invalid email or password.');
    }
    return user;
  }

  async sessionFor(user: StoredUser, deviceTrusted: boolean): Promise<UserSession> {
    const w = await this.storage.getWorkspace(user.organizationId);
    return this.toSession(user, w?.ws, deviceTrusted);
  }

  async changePassword(userId: string, current: string, next: string, keepToken?: string) {
    const user = await this.storage.getUserById(userId);
    if (!user || !(await verifyPassword(current, user.passwordHash))) {
      throw new UserFacingError('Current password is incorrect.');
    }
    user.passwordHash = await hashPassword(next);
    user.trustedDevices = []; // a password change invalidates every remembered device
    await this.storage.updateUser(user);
    await this.storage.deleteUserSessions(userId, keepToken ? sha256(keepToken) : undefined);
  }

  async updateName(userId: string, name: string): Promise<UserSession | null> {
    const user = await this.storage.getUserById(userId);
    if (!user) return null;
    user.name = name;
    await this.storage.updateUser(user);
    await this.mutateWorkspace(user.organizationId, (ws) => {
      const owner = ws.team.find((m) => m.role === 'Owner');
      if (owner) owner.name = name;
    });
    const w = await this.storage.getWorkspace(user.organizationId);
    return this.toSession(user, w?.ws);
  }

  // --- email verification / password reset tokens ---

  async createToken(userId: string, kind: TokenRecord['kind']): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await this.storage.putToken(sha256(token), {
      userId,
      kind,
      expiresAt: Date.now() + (kind === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS),
    });
    return token;
  }

  /** Single-use: a valid token is consumed atomically, even if several servers receive it. */
  async consumeToken(token: string, kind: TokenRecord['kind']): Promise<StoredUser | null> {
    const rec = await this.storage.takeToken(sha256(token), kind);
    return rec ? this.storage.getUserById(rec.userId) : null;
  }

  async markVerified(userId: string) {
    const user = await this.storage.getUserById(userId);
    if (user && !user.emailVerified) {
      user.emailVerified = true;
      await this.storage.updateUser(user);
    }
  }

  async resetPassword(userId: string, newPassword: string) {
    const user = await this.storage.getUserById(userId);
    if (!user) return;
    user.passwordHash = await hashPassword(newPassword);
    user.emailVerified = true; // they proved control of the inbox
    user.trustedDevices = [];
    await this.storage.updateUser(user);
    await this.storage.deleteUserSessions(userId);
  }

  // --- phone numbers (simulated until a telephony provider is connected) ---

  provisionSystemNumber(
    ws: TenantWorkspace,
    areaCodeRaw: string,
    numberType: 'Local DID' | 'Toll-Free 888'
  ): PhoneSetupConfig {
    const areaCode = numberType === 'Toll-Free 888' ? '888' : areaCodeRaw;
    const formatted = randomPhone(areaCode);
    ws.phoneSetup = {
      ...ws.phoneSetup,
      systemNumber: formatted,
      systemNumberAreaCode: areaCode,
      systemNumberType: numberType,
      systemNumberStatus: 'Active',
      systemNumberProvisionedAt: 'Reserved just now (simulated)',
      forwardingVerified: false,
      lastSystemTestAt: undefined,
    };
    this.notify(ws, {
      type: 'System',
      title: `Simulated System Number: ${formatted}`,
      body: `A placeholder ${numberType} line was reserved for ${ws.voiceAgent.agentName}. It cannot receive real calls until a telephony provider is connected.`,
      targetPath: '/app/phone-setup',
    });
    return ws.phoneSetup;
  }
}

/** Process-wide instance used by the HTTP server (call `await store.init()` before serving). */
export const store = new PlumbVoiceStore();

/**
 * Retention rule: when the owner set "keep recordings N days", audio older than that is detached from the call.
 * The transcript, summary and lead are kept. Runs on every save, so no scheduler is needed.
 */
export function purgeExpiredRecordings(ws: TenantWorkspace, now = Date.now()): number {
  const days = ws.extras?.recording?.retentionDays ?? 0;
  if (!(days > 0)) return 0;
  const cutoff = now - days * 86_400_000;
  let n = 0;
  for (const c of ws.calls) {
    if (!c.recordingUrl) continue;
    const at = Date.parse(c.createdAtISO ?? '');
    if (Number.isFinite(at) && at < cutoff) {
      delete c.recordingUrl;
      c.recordingAvailable = false;
      c.recordingDeletedAtISO = new Date(now).toISOString();
      n++;
    }
  }
  return n;
}
