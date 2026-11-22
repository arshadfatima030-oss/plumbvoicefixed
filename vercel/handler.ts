import type {IncomingMessage, ServerResponse} from 'node:http';
import {startServer} from '../server.ts';

let appPromise: ReturnType<typeof startServer> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    appPromise ??= startServer();
    const app = await appPromise;
    if (!app) throw new Error('App did not start');
    app(req as never, res as never);
  } catch (err) {
    appPromise = undefined; // retry on the next request
    console.error('[vercel] startup failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({error: 'Server could not start. Check DATABASE_URL.'}));
  }
}
