import type {Request, Response, NextFunction} from 'express';

type AnyHandler = (req: Request, res: Response, next: NextFunction) => unknown;

/**
 * Express 4 does not catch errors thrown (or promises rejected) inside async handlers; on modern
 * Node an unhandled rejection kills the whole process. Wrapping forwards every failure to the
 * Express error handler, which answers with a clean 500 instead.
 */
export function wrapHandler<T>(fn: T): T {
  if (typeof fn !== 'function') return fn;
  if (fn.length === 4) return fn; // error-handling middleware keeps its signature
  const handler = fn as unknown as AnyHandler;
  const wrapped = (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = handler(req, res, next) as {then?: unknown; catch?: (cb: (e: unknown) => void) => unknown} | undefined;
      if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
  return wrapped as unknown as T;
}

/** Makes every route/middleware registered on `app` crash-safe, sync or async. */
export function makeAsyncSafe(app: unknown) {
  const target = app as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    const original = target[method].bind(app);
    target[method] = (...args: unknown[]) => original(...args.map((a) => wrapHandler(a)));
  }
}

/**
 * Last-resort guards. An unhandled rejection is logged and the server keeps serving. A truly
 * uncaught exception leaves the process in an unknown state, so it is logged, in-flight work is
 * drained, and the process exits so the supervisor (Docker `restart`, pm2, systemd) starts a fresh one.
 */
export function installProcessGuards(onFatal: () => void) {
  process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandled rejection (continuing):', reason instanceof Error ? reason.stack || reason.message : reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[process] uncaught exception, shutting down gracefully:', err.stack || err.message);
    onFatal();
  });
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
