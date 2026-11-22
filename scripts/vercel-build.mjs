// Builds the frontend + bundles the Express server into a Vercel "Build Output API" folder.
import {build} from 'esbuild';
import {cpSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';

execSync('npx vite build', {stdio: 'inherit'});

const out = '.vercel/output';
rmSync(out, {recursive: true, force: true});
cpSync('dist', `${out}/static`, {recursive: true});

const fn = `${out}/functions/api.func`;
mkdirSync(fn, {recursive: true});

await build({
  entryPoints: ['vercel/handler.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg-native', 'vite'],
  banner: {js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);"},
  logLevel: 'info',
});

writeFileSync(`${fn}/package.json`, JSON.stringify({type: 'module'}));
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30})
);
const cronSchedule = (process.env.CRON_SCHEDULE ?? '').trim() || '0 17 * * *';
if (!/^(\S+\s+){4}\S+$/.test(cronSchedule)) throw new Error(`CRON_SCHEDULE must be a 5-field cron expression, got: ${cronSchedule}`);
console.log(`Reminder cron schedule: ${cronSchedule}`);
writeFileSync(
  `${out}/config.json`,
  JSON.stringify({
    version: 3,
    // Reminder texts. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.
    // Default is once a day (17:00 UTC, daytime in every US time zone) because Vercel Hobby only accepts daily crons.
    // On Pro set CRON_SCHEDULE="0 * * * *" (hourly) in the Vercel build environment so reminders, SMS retries and the
    // outbox are processed promptly. Without Pro, call the endpoint every 30-60 min from an external scheduler instead.
    crons: [{path: '/api/cron/reminders', schedule: cronSchedule}],
    routes: [
      // Security headers for static files too (the API responses get theirs from server.ts). Keep CSP in sync with server.ts.
      {
        src: '/(.*)',
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Strict-Transport-Security': 'max-age=15552000',
          'Content-Security-Policy': [
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
          ].join('; '),
        },
        continue: true,
      },
      {src: '/api/(.*)', dest: '/api'},
      {handle: 'filesystem'},
      {src: '/(.*)', dest: '/index.html'},
    ],
  })
);
console.log('Vercel output ready.');
