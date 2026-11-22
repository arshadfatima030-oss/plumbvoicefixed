import type {Request, Response, NextFunction} from 'express';
import {store} from './store.ts';

/**
 * Per-process fallback counter. Used only when shared storage is unreachable, so that an outage in
 * the counter degrades to "limited per server" instead of "not limited at all". Bounded in size.
 */
const FALLBACK_MAX_KEYS = 10_000;
const fallback = new Map<string, {count: number; resetAt: number}>();

export function fallbackHit(key: string, windowMs: number, now = Date.now()): {count: number; resetAt: number} {
  const cur = fallback.get(key);
  if (cur && cur.resetAt > now) {
    cur.count += 1;
    return cur;
  }
  if (fallback.size >= FALLBACK_MAX_KEYS) {
    for (const [k, v] of fallback) if (v.resetAt <= now) fallback.delete(k);
    // Still full of live entries: drop the oldest insertion so memory stays bounded.
    if (fallback.size >= FALLBACK_MAX_KEYS) {
      const oldest = fallback.keys().next().value;
      if (oldest !== undefined) fallback.delete(oldest);
    }
  }
  const fresh = {count: 1, resetAt: now + windowMs};
  fallback.set(key, fresh);
  return fresh;
}

/** Test helper. */
export function _resetFallback() {
  fallback.clear();
}

/**
 * Fixed-window rate limiter backed by shared storage, so the limit applies across ALL servers
 * (with Postgres) rather than per process. If storage is briefly unreachable it falls back to a
 * per-process counter (and logs), so an outage in the counter never locks every user out, but
 * also never leaves an endpoint completely unlimited.
 */
export function createRateLimiter(opts: {
  /** Distinct per limiter, so two limiters with the same max/window never share counters. */
  name: string;
  windowMs: number;
  max: number;
  key: (req: Request) => string;
  message?: string;
}) {
  const name = `${opts.name}:${opts.max}/${opts.windowMs}`;
  return async (req: Request, res: Response, next: NextFunction) => {
    const fullKey = `${name}|${opts.key(req)}`;
    let hit: {count: number; resetAt: number};
    try {
      hit = await store.hit(fullKey, opts.windowMs);
    } catch (err) {
      console.error('[rateLimit] storage error, using in-memory fallback:', err instanceof Error ? err.message : err);
      hit = fallbackHit(fullKey, opts.windowMs);
    }
    if (hit.count > opts.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000))));
      res.status(429).json({error: opts.message || 'Too many requests. Please try again later.'});
      return;
    }
    next();
  };
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
