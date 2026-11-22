import fs from 'node:fs';
import path from 'node:path';
import type {TenantWorkspace, UserSession} from '../src/types/plumbvoice.ts';

export interface TrustedDevice {
  hash: string; // sha256 of the device cookie value
  label: string;
  expiresAt: number;
}

export interface StoredUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  emailKey: string;
  passwordHash: string;
  role: UserSession['role'];
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  /** Legacy field, no longer used. */
  knownDevices: string[];
  /** Devices the user chose to remember; sign-in and sensitive actions skip the emailed code on these. */
  trustedDevices?: TrustedDevice[];
  createdAt: string;
}

export interface SessionRecord {
  userId: string;
  expiresAt: number;
  /** Until this time (ms) a session on an untrusted device may do sensitive actions without a new code. */
  stepUpUntil?: number;
}

export interface CodeRecord {
  userId: string;
  purpose: 'login' | 'action';
  codeHash: string;
  attempts: number;
  expiresAt: number;
  /** Login challenges remember whether the user ticked "remember this device". */
  remember?: boolean;
}

export interface TokenRecord {
  userId: string;
  kind: 'verify' | 'reset';
  expiresAt: number;
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  company: string;
  trade: string;
  message: string;
  createdAt: string;
}

export interface VersionedWorkspace {
  ws: TenantWorkspace;
  version: number;
}

/**
 * Everything the app needs to remember lives behind this interface, so any number of
 * server processes can share one backend. Servers keep NO per-user state in memory.
 */
export interface Storage {
  readonly kind: 'memory' | 'postgres';
  init(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;

  getUserById(id: string): Promise<StoredUser | null>;
  getUserByEmailKey(key: string): Promise<StoredUser | null>;
  /** Creates the user and their workspace atomically. Returns false if the email is taken. */
  createAccount(user: StoredUser, ws: TenantWorkspace): Promise<boolean>;
  updateUser(user: StoredUser): Promise<void>;

  getWorkspace(organizationId: string): Promise<VersionedWorkspace | null>;
  /** Compare-and-set. Returns the new version, or null if someone else saved first. */
  saveWorkspace(organizationId: string, ws: TenantWorkspace, expectedVersion: number): Promise<number | null>;

  putSession(hash: string, rec: SessionRecord): Promise<void>;
  getSession(hash: string): Promise<SessionRecord | null>;
  deleteSession(hash: string): Promise<void>;
  deleteUserSessions(userId: string, exceptHash?: string): Promise<void>;
  setSessionStepUp(hash: string, until: number): Promise<void>;

  /** One-time emailed codes (sign-in and sensitive-action confirmation). */
  putCode(id: string, rec: CodeRecord): Promise<void>;
  /** Atomically counts a guess and returns the record (null if missing/expired). */
  bumpCode(id: string): Promise<CodeRecord | null>;
  /** Deletes a code; true only for the one caller that actually removed it (single use across servers). */
  deleteCode(id: string): Promise<boolean>;

  /** Stores a single-use token, replacing any earlier token of the same kind for that user. */
  putToken(hash: string, rec: TokenRecord): Promise<void>;
  /** Atomically fetches and deletes a valid token (single use, safe across servers). */
  takeToken(hash: string, kind: TokenRecord['kind']): Promise<TokenRecord | null>;

  /** Shared fixed-window counter used for rate limiting across all servers. */
  hit(key: string, windowMs: number): Promise<{count: number; resetAt: number}>;

  addContactMessage(msg: ContactMessage): Promise<void>;

  /** Outgoing-webhook delivery log. Keeps the newest WEBHOOK_LOG_KEEP entries per workspace. */
  addWebhookLog(organizationId: string, item: WebhookLogRecord): Promise<void>;
  listWebhookLog(organizationId: string, limit: number): Promise<WebhookLogRecord[]>;

  /** Who did what in a workspace (successful changes only). Keeps the newest AUDIT_LOG_KEEP per workspace. */
  addAuditLog(organizationId: string, item: AuditLogRecord): Promise<void>;
  listAuditLog(organizationId: string, limit: number): Promise<AuditLogRecord[]>;

  /** Workspaces that have at least one Scheduled reminder due on or before `todayISO` (YYYY-MM-DD). */
  listWorkspaceIdsWithDueReminders(todayISO: string): Promise<string[]>;
  /** Workspaces with an outbox entry ready to send (pending and due, or a send whose lease expired). */
  listWorkspaceIdsWithDueOutbox(nowISO: string): Promise<string[]>;
  purgeExpired(): Promise<void>;
}

export interface AuditLogRecord {
  id: string;
  at: string;
  userEmail: string;
  role: string;
  action: string;
  target?: string;
}

export const AUDIT_LOG_KEEP = 500;

export interface WebhookLogRecord {
  id: string;
  type: string;
  at: string;
  ok: boolean;
  status: number;
  attempts: number;
  error?: string;
}

export const WEBHOOK_LOG_KEEP = 200;

/**
 * In-process storage for development and single-server use. Returns deep copies so callers
 * behave exactly as they would against a database. Optionally snapshots to a JSON file.
 * NOT shared between processes: set DATABASE_URL to run more than one server.
 */
export class MemoryStorage implements Storage {
  readonly kind = 'memory' as const;
  private users = new Map<string, StoredUser>();
  private emailIndex = new Map<string, string>();
  private workspaces = new Map<string, VersionedWorkspace>();
  private sessions = new Map<string, SessionRecord>();
  private tokens = new Map<string, TokenRecord & {hash: string}>();
  private codes = new Map<string, CodeRecord>();
  private limits = new Map<string, {count: number; resetAt: number}>();
  private contacts: ContactMessage[] = [];
  private webhookLogs = new Map<string, WebhookLogRecord[]>();
  private auditLogs = new Map<string, AuditLogRecord[]>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private file: string | null) {}

  async init() {
    if (!this.file) return;
    try {
      const snap = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const u of snap.users ?? []) {
        this.users.set(u.id, u);
        this.emailIndex.set(u.emailKey, u.id);
      }
      this.workspaces = new Map(snap.workspaces ?? []);
      this.sessions = new Map(snap.sessions ?? []);
      this.tokens = new Map(snap.tokens ?? []);
      this.contacts = snap.contacts ?? [];
      this.webhookLogs = new Map(snap.webhookLogs ?? []);
      this.auditLogs = new Map(snap.auditLogs ?? []);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[storage] could not read snapshot, starting empty:', (err as Error).message);
      }
    }
    await this.purgeExpired();
  }

  async ping() {}

  async close() {
    this.flush();
  }

  private touch() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 500);
    this.saveTimer.unref();
  }

  private flush() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), {recursive: true});
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          users: [...this.users.values()],
          workspaces: [...this.workspaces],
          sessions: [...this.sessions],
          tokens: [...this.tokens],
          contacts: this.contacts,
          webhookLogs: [...this.webhookLogs],
          auditLogs: [...this.auditLogs],
        }),
        {mode: 0o600}
      );
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[storage] snapshot write failed:', (err as Error).message);
    }
  }

  async getUserById(id: string) {
    const u = this.users.get(id);
    return u ? structuredClone(u) : null;
  }

  async getUserByEmailKey(key: string) {
    const id = this.emailIndex.get(key);
    return id ? this.getUserById(id) : null;
  }

  async createAccount(user: StoredUser, ws: TenantWorkspace) {
    if (this.emailIndex.has(user.emailKey)) return false;
    this.users.set(user.id, structuredClone(user));
    this.emailIndex.set(user.emailKey, user.id);
    this.workspaces.set(user.organizationId, {ws: structuredClone(ws), version: 1});
    this.touch();
    return true;
  }

  async updateUser(user: StoredUser) {
    this.users.set(user.id, structuredClone(user));
    this.touch();
  }

  async getWorkspace(organizationId: string) {
    const w = this.workspaces.get(organizationId);
    return w ? {ws: structuredClone(w.ws), version: w.version} : null;
  }

  async saveWorkspace(organizationId: string, ws: TenantWorkspace, expectedVersion: number) {
    const cur = this.workspaces.get(organizationId);
    if (!cur || cur.version !== expectedVersion) return null;
    const version = cur.version + 1;
    this.workspaces.set(organizationId, {ws: structuredClone(ws), version});
    this.touch();
    return version;
  }

  async putSession(hash: string, rec: SessionRecord) {
    this.sessions.set(hash, rec);
    this.touch();
  }

  async getSession(hash: string) {
    const s = this.sessions.get(hash);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      this.sessions.delete(hash);
      return null;
    }
    return {...s};
  }

  async deleteSession(hash: string) {
    this.sessions.delete(hash);
    this.touch();
  }

  async deleteUserSessions(userId: string, exceptHash?: string) {
    for (const [k, v] of this.sessions) if (v.userId === userId && k !== exceptHash) this.sessions.delete(k);
    this.touch();
  }

  async setSessionStepUp(hash: string, until: number) {
    const s = this.sessions.get(hash);
    if (s) s.stepUpUntil = until;
    this.touch();
  }

  async putCode(id: string, rec: CodeRecord) {
    // One live code per user and purpose.
    for (const [k, v] of this.codes) if (v.userId === rec.userId && v.purpose === rec.purpose) this.codes.delete(k);
    this.codes.set(id, {...rec});
  }

  async bumpCode(id: string) {
    const c = this.codes.get(id);
    if (!c || c.expiresAt <= Date.now()) {
      this.codes.delete(id);
      return null;
    }
    c.attempts += 1;
    return {...c};
  }

  async deleteCode(id: string) {
    return this.codes.delete(id);
  }

  async putToken(hash: string, rec: TokenRecord) {
    for (const [k, v] of this.tokens) if (v.userId === rec.userId && v.kind === rec.kind) this.tokens.delete(k);
    this.tokens.set(hash, {...rec, hash});
    this.touch();
  }

  async takeToken(hash: string, kind: TokenRecord['kind']) {
    const t = this.tokens.get(hash);
    if (!t || t.kind !== kind || t.expiresAt <= Date.now()) return null;
    this.tokens.delete(hash);
    this.touch();
    return {userId: t.userId, kind: t.kind, expiresAt: t.expiresAt};
  }

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    let b = this.limits.get(key);
    if (!b || b.resetAt <= now) b = {count: 0, resetAt: now + windowMs};
    b.count += 1;
    this.limits.set(key, b);
    return {...b};
  }

  async addContactMessage(msg: ContactMessage) {
    this.contacts.unshift(msg);
    if (this.contacts.length > 500) this.contacts.length = 500;
    this.touch();
  }

  async addWebhookLog(organizationId: string, item: WebhookLogRecord) {
    const arr = this.webhookLogs.get(organizationId) ?? [];
    arr.unshift({...item});
    if (arr.length > WEBHOOK_LOG_KEEP) arr.length = WEBHOOK_LOG_KEEP;
    this.webhookLogs.set(organizationId, arr);
    this.touch();
  }

  async listWebhookLog(organizationId: string, limit: number) {
    return (this.webhookLogs.get(organizationId) ?? []).slice(0, limit).map((i) => ({...i}));
  }

  async addAuditLog(organizationId: string, item: AuditLogRecord) {
    const arr = this.auditLogs.get(organizationId) ?? [];
    arr.unshift({...item});
    if (arr.length > AUDIT_LOG_KEEP) arr.length = AUDIT_LOG_KEEP;
    this.auditLogs.set(organizationId, arr);
    this.touch();
  }

  async listAuditLog(organizationId: string, limit: number) {
    return (this.auditLogs.get(organizationId) ?? []).slice(0, limit).map((i) => ({...i}));
  }

  async listWorkspaceIdsWithDueReminders(todayISO: string) {
    const out: string[] = [];
    for (const [id, w] of this.workspaces) {
      if ((w.ws.reminders ?? []).some((r) => r.status === 'Scheduled' && r.dueDateISO <= todayISO)) out.push(id);
    }
    return out;
  }

  async listWorkspaceIdsWithDueOutbox(nowISO: string) {
    const out: string[] = [];
    for (const [id, w] of this.workspaces) {
      if ((w.ws.outbox ?? []).some((e) => (e.status === 'pending' && e.nextAttemptISO <= nowISO) || (e.status === 'sending' && (e.leaseUntilISO ?? '') <= nowISO))) out.push(id);
    }
    return out;
  }

  async purgeExpired() {
    const now = Date.now();
    for (const [k, v] of this.sessions) if (v.expiresAt <= now) this.sessions.delete(k);
    for (const [k, v] of this.tokens) if (v.expiresAt <= now) this.tokens.delete(k);
    for (const [k, v] of this.limits) if (v.resetAt <= now) this.limits.delete(k);
    for (const [k, v] of this.codes) if (v.expiresAt <= now) this.codes.delete(k);
  }
}

export async function createStorage(): Promise<Storage> {
  if (process.env.DATABASE_URL) {
    const {PostgresStorage} = await import('./pgStorage.ts');
    return new PostgresStorage(process.env.DATABASE_URL);
  }
  const file =
    process.env.DATA_FILE === 'memory' ? null : process.env.DATA_FILE || path.resolve(process.cwd(), 'data', 'store.json');
  return new MemoryStorage(file);
}
