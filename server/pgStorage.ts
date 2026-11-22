import type {TenantWorkspace} from '../src/types/plumbvoice.ts';
import type {
  CodeRecord,
  ContactMessage,
  SessionRecord,
  Storage,
  StoredUser,
  TokenRecord,
  VersionedWorkspace,
  WebhookLogRecord,
  AuditLogRecord,
} from './storage.ts';
import {WEBHOOK_LOG_KEEP, AUDIT_LOG_KEEP} from './storage.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PostgreSQL-backed storage. Every server instance talks to the same database, so sessions,
 * accounts, workspaces and rate-limit counters are shared and any server can serve any request.
 * Workspaces are stored as one JSONB document per business with an optimistic-lock version.
 */
export class PostgresStorage implements Storage {
  readonly kind = 'postgres' as const;
  private pool: any;

  constructor(private url: string) {}

  /** Checked-out clients have no pool error listener, so a dropped connection would crash the process without this. */
  private async withClient<T>(fn: (client: any) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const onError = (err: Error) => console.error('[pg] client error:', err.message);
    client.on('error', onError);
    try {
      return await fn(client);
    } finally {
      client.removeListener('error', onError);
      client.release();
    }
  }

  async init() {
    try {
      await this.initInner();
    } catch (err) {
      await this.pool?.end().catch(() => {}); // don't leak a pool when startup is retried
      this.pool = undefined;
      throw err;
    }
  }

  private async initInner() {
    const pg: any = await import('pg');
    const Pool = pg.Pool ?? pg.default?.Pool;
    this.pool = new Pool({
      connectionString: this.url,
      // Serverless: each instance gets its own pool, so keep it small or many instances exhaust the database.
      max: Number(process.env.DATABASE_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
      // pg waits forever by default; a stuck connect would otherwise hang until the function is killed.
      // 10 s (not 5) because a suspended Neon compute can take several seconds to wake up on the first connection.
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10_000),
      idleTimeoutMillis: 10_000,
      query_timeout: Number(process.env.DATABASE_QUERY_TIMEOUT_MS || 15_000),
      allowExitOnIdle: Boolean(process.env.VERCEL),
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? {rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'}
          : undefined,
    });
    this.pool.on('error', (err: Error) => console.error('[pg] idle client error:', err.message));

    // Several servers may boot at once; serialise schema creation with an advisory lock.
    // Transaction-level lock on purpose: it is released automatically at COMMIT/ROLLBACK, so it stays correct behind a
    // connection pooler such as Neon's "-pooler" endpoint (PgBouncer), where a session-level lock/unlock pair can land on
    // different server connections and leave the lock stuck (the next boot would then hang).
    await this.withClient(async (client) => {
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(727274)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id text PRIMARY KEY,
          email_key text NOT NULL UNIQUE,
          organization_id text NOT NULL,
          data jsonb NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspaces (
          organization_id text PRIMARY KEY,
          version integer NOT NULL DEFAULT 1,
          data jsonb NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash text PRIMARY KEY,
          user_id text NOT NULL,
          expires_at bigint NOT NULL,
          step_up_until bigint
        );
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS step_up_until bigint;
        CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
        CREATE TABLE IF NOT EXISTS codes (
          id text PRIMARY KEY,
          user_id text NOT NULL,
          purpose text NOT NULL,
          code_hash text NOT NULL,
          attempts integer NOT NULL DEFAULT 0,
          remember boolean NOT NULL DEFAULT false,
          expires_at bigint NOT NULL
        );
        CREATE INDEX IF NOT EXISTS codes_user_idx ON codes (user_id, purpose);
        CREATE TABLE IF NOT EXISTS tokens (
          token_hash text PRIMARY KEY,
          user_id text NOT NULL,
          kind text NOT NULL,
          expires_at bigint NOT NULL
        );
        CREATE INDEX IF NOT EXISTS tokens_user_idx ON tokens (user_id, kind);
        CREATE TABLE IF NOT EXISTS rate_limits (
          key text PRIMARY KEY,
          count integer NOT NULL,
          reset_at bigint NOT NULL
        );
        CREATE TABLE IF NOT EXISTS contact_messages (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS webhook_logs (
          id text PRIMARY KEY,
          organization_id text NOT NULL,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS webhook_logs_org_idx ON webhook_logs (organization_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS audit_logs (
          id text PRIMARY KEY,
          organization_id text NOT NULL,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs (organization_id, created_at DESC);
      `);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    });
  }

  async ping() {
    await this.pool.query('SELECT 1');
  }

  async close() {
    await this.pool?.end();
  }

  async getUserById(id: string) {
    const r = await this.pool.query('SELECT data FROM users WHERE id = $1', [id]);
    return (r.rows[0]?.data as StoredUser) ?? null;
  }

  async getUserByEmailKey(key: string) {
    const r = await this.pool.query('SELECT data FROM users WHERE email_key = $1', [key]);
    return (r.rows[0]?.data as StoredUser) ?? null;
  }

  async createAccount(user: StoredUser, ws: TenantWorkspace) {
    return this.withClient(async (client) => {
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        'INSERT INTO users (id, email_key, organization_id, data) VALUES ($1,$2,$3,$4) ON CONFLICT (email_key) DO NOTHING',
        [user.id, user.emailKey, user.organizationId, JSON.stringify(user)]
      );
      if (ins.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query('INSERT INTO workspaces (organization_id, version, data) VALUES ($1, 1, $2)', [
        user.organizationId,
        JSON.stringify(ws),
      ]);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    });
  }

  async updateUser(user: StoredUser) {
    await this.pool.query('UPDATE users SET data = $2 WHERE id = $1', [user.id, JSON.stringify(user)]);
  }

  async getWorkspace(organizationId: string): Promise<VersionedWorkspace | null> {
    const r = await this.pool.query('SELECT data, version FROM workspaces WHERE organization_id = $1', [organizationId]);
    return r.rows[0] ? {ws: r.rows[0].data as TenantWorkspace, version: r.rows[0].version} : null;
  }

  async saveWorkspace(organizationId: string, ws: TenantWorkspace, expectedVersion: number) {
    const r = await this.pool.query(
      'UPDATE workspaces SET data = $2, version = version + 1 WHERE organization_id = $1 AND version = $3 RETURNING version',
      [organizationId, JSON.stringify(ws), expectedVersion]
    );
    return r.rows[0] ? (r.rows[0].version as number) : null;
  }

  async putSession(hash: string, rec: SessionRecord) {
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, expires_at, step_up_until) VALUES ($1,$2,$3,$4)', [
      hash,
      rec.userId,
      rec.expiresAt,
      rec.stepUpUntil ?? null,
    ]);
  }

  async getSession(hash: string): Promise<SessionRecord | null> {
    const r = await this.pool.query(
      'SELECT user_id, expires_at, step_up_until FROM sessions WHERE token_hash = $1',
      [hash]
    );
    const row = r.rows[0];
    if (!row) return null;
    const expiresAt = Number(row.expires_at);
    if (expiresAt <= Date.now()) {
      await this.deleteSession(hash);
      return null;
    }
    return {
      userId: row.user_id,
      expiresAt,
      stepUpUntil: row.step_up_until == null ? undefined : Number(row.step_up_until),
    };
  }

  async deleteSession(hash: string) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash]);
  }

  async deleteUserSessions(userId: string, exceptHash?: string) {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, exceptHash ?? '']);
  }

  async setSessionStepUp(hash: string, until: number) {
    await this.pool.query('UPDATE sessions SET step_up_until = $2 WHERE token_hash = $1', [hash, until]);
  }

  async putCode(id: string, rec: CodeRecord) {
    await this.withClient(async (client) => {
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM codes WHERE user_id = $1 AND purpose = $2', [rec.userId, rec.purpose]);
      await client.query(
        'INSERT INTO codes (id, user_id, purpose, code_hash, attempts, remember, expires_at) VALUES ($1,$2,$3,$4,0,$5,$6)',
        [id, rec.userId, rec.purpose, rec.codeHash, rec.remember === true, rec.expiresAt]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    });
  }

  async bumpCode(id: string): Promise<CodeRecord | null> {
    const r = await this.pool.query(
      `UPDATE codes SET attempts = attempts + 1 WHERE id = $1 AND expires_at > $2
       RETURNING user_id, purpose, code_hash, attempts, remember, expires_at`,
      [id, Date.now()]
    );
    const row = r.rows[0];
    return row
      ? {
          userId: row.user_id,
          purpose: row.purpose,
          codeHash: row.code_hash,
          attempts: row.attempts,
          remember: row.remember,
          expiresAt: Number(row.expires_at),
        }
      : null;
  }

  async deleteCode(id: string) {
    const r = await this.pool.query('DELETE FROM codes WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async putToken(hash: string, rec: TokenRecord) {
    await this.withClient(async (client) => {
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM tokens WHERE user_id = $1 AND kind = $2', [rec.userId, rec.kind]);
      await client.query('INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES ($1,$2,$3,$4)', [
        hash,
        rec.userId,
        rec.kind,
        rec.expiresAt,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    });
  }

  async takeToken(hash: string, kind: TokenRecord['kind']): Promise<TokenRecord | null> {
    // DELETE ... RETURNING is atomic, so a link can only be redeemed once even across servers.
    const r = await this.pool.query(
      'DELETE FROM tokens WHERE token_hash = $1 AND kind = $2 AND expires_at > $3 RETURNING user_id, kind, expires_at',
      [hash, kind, Date.now()]
    );
    const row = r.rows[0];
    return row ? {userId: row.user_id, kind: row.kind, expiresAt: Number(row.expires_at)} : null;
  }

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    const r = await this.pool.query(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= $3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= $3 THEN $2 ELSE rate_limits.reset_at END
       RETURNING count, reset_at`,
      [key, now + windowMs, now]
    );
    return {count: r.rows[0].count as number, resetAt: Number(r.rows[0].reset_at)};
  }

  async addContactMessage(msg: ContactMessage) {
    await this.pool.query('INSERT INTO contact_messages (id, data) VALUES ($1,$2)', [msg.id, JSON.stringify(msg)]);
  }

  async addWebhookLog(organizationId: string, item: WebhookLogRecord) {
    await this.pool.query(
      'INSERT INTO webhook_logs (id, organization_id, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
      [item.id, organizationId, JSON.stringify(item)]
    );
    // Keep only the newest entries per workspace.
    await this.pool.query(
      `DELETE FROM webhook_logs WHERE organization_id = $1 AND id NOT IN (
         SELECT id FROM webhook_logs WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
      [organizationId, WEBHOOK_LOG_KEEP]
    );
  }

  async listWebhookLog(organizationId: string, limit: number): Promise<WebhookLogRecord[]> {
    const r = await this.pool.query(
      'SELECT data FROM webhook_logs WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
      [organizationId, limit]
    );
    return r.rows.map((row: any) => row.data as WebhookLogRecord);
  }

  async addAuditLog(organizationId: string, item: AuditLogRecord) {
    await this.pool.query('INSERT INTO audit_logs (id, organization_id, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [item.id, organizationId, JSON.stringify(item)]);
    await this.pool.query(
      `DELETE FROM audit_logs WHERE organization_id = $1 AND id NOT IN (
         SELECT id FROM audit_logs WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
      [organizationId, AUDIT_LOG_KEEP]
    );
  }

  async listAuditLog(organizationId: string, limit: number): Promise<AuditLogRecord[]> {
    const r = await this.pool.query('SELECT data FROM audit_logs WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [organizationId, limit]);
    return r.rows.map((row: any) => row.data as AuditLogRecord);
  }

  async listWorkspaceIdsWithDueReminders(todayISO: string): Promise<string[]> {
    const r = await this.pool.query(
      `SELECT organization_id FROM workspaces w WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(w.data->'reminders', '[]'::jsonb)) rem
         WHERE rem->>'status' = 'Scheduled' AND rem->>'dueDateISO' <= $1)`,
      [todayISO]
    );
    return r.rows.map((row: any) => row.organization_id as string);
  }

  async listWorkspaceIdsWithDueOutbox(nowISO: string): Promise<string[]> {
    const r = await this.pool.query(
      `SELECT organization_id FROM workspaces w WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(w.data->'outbox', '[]'::jsonb)) o
         WHERE (o->>'status' = 'pending' AND o->>'nextAttemptISO' <= $1)
            OR (o->>'status' = 'sending' AND COALESCE(o->>'leaseUntilISO', '') <= $1))`,
      [nowISO]
    );
    return r.rows.map((row: any) => row.organization_id as string);
  }

  async purgeExpired() {
    const now = Date.now();
    await this.pool.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
    await this.pool.query('DELETE FROM tokens WHERE expires_at <= $1', [now]);
    await this.pool.query('DELETE FROM rate_limits WHERE reset_at <= $1', [now]);
    await this.pool.query('DELETE FROM codes WHERE expires_at <= $1', [now]);
  }
}
