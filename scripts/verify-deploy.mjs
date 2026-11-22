// Quick post-deploy check. Usage: node scripts/verify-deploy.mjs https://your-app.example.com [CRON_SECRET]
// Read-only: it never creates data. Prints PASS / FAIL / WARN per item and exits 1 if anything failed.
const base = (process.argv[2] || '').replace(/\/+$/, '');
const cronSecret = process.argv[3] || '';
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: node scripts/verify-deploy.mjs https://your-app.example.com [CRON_SECRET]');
  process.exit(2);
}
let failed = 0;
const out = (tag, msg) => console.log(`${tag.padEnd(5)} ${msg}`);
const pass = (m) => out('PASS', m);
const fail = (m) => (failed++, out('FAIL', m));
const warn = (m) => out('WARN', m);
const get = async (path, init) => {
  try {
    const r = await fetch(base + path, {redirect: 'manual', signal: AbortSignal.timeout(20000), ...init});
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return {status: r.status, headers: r.headers, text, json};
  } catch (e) {
    return {status: 0, headers: new Headers(), text: String(e), json: null};
  }
};

const health = await get('/api/health');
if (health.status !== 200 || !health.json?.ok) fail(`/api/health did not answer (status ${health.status}). The Express API is not running at this address.`);
else {
  pass('Express API is running (not static-only)');
  if (health.json.storage === 'postgres') pass('Storage backend: postgres (data persists)');
  else fail(`Storage backend is "${health.json.storage}". Set DATABASE_URL, otherwise data is lost on restart/redeploy.`);
}

if (health.json?.mail === true) pass('E-mail provider configured (verification and password reset can be delivered)');
else if (health.json) fail('E-mail provider NOT configured. Set SENDGRID_API_KEY and MAIL_FROM (production sign-up is blocked until then).');

const ready = await get('/api/ready');
ready.status === 200 && ready.json?.ready ? pass('Database reachable (/api/ready)') : fail(`Database not reachable (/api/ready status ${ready.status})`);

const home = await get('/');
home.status === 200 && /<div id="root"/.test(home.text) ? pass('Front end served') : fail(`Front end not served at / (status ${home.status})`);
const deep = await get('/app/overview');
deep.status === 200 && /<div id="root"/.test(deep.text) ? pass('Deep links work (/app/overview)') : fail('Deep links do not load the app (SPA fallback missing)');

const me = await get('/api/auth/me');
me.status === 200 && me.json && 'user' in me.json ? pass('Auth API answers') : fail(`/api/auth/me unexpected (status ${me.status})`);

const prot = await get('/api/workspace');
prot.status === 401 ? pass('Private data requires login (/api/workspace -> 401)') : fail(`/api/workspace returned ${prot.status} without login, expected 401`);

const hdr = health.headers;
hdr.get('x-content-type-options') ? pass('Security headers present') : warn('Security headers missing');
if (base.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(base)) warn('Not using HTTPS. Cookies/logins need HTTPS in production.');

const noAuth = await get('/api/cron/reminders');
if (noAuth.status === 401) pass('Cron endpoint is protected');
else if (noAuth.status === 503) warn('CRON_SECRET is not set, so scheduled reminders will not run (on Vercel).');
else fail(`Cron endpoint answered ${noAuth.status} without a secret`);
if (cronSecret) {
  const c = await get('/api/cron/reminders', {headers: {Authorization: `Bearer ${cronSecret}`}});
  c.status === 200 && c.json?.ok ? pass(`Cron run works (${c.json.skipped ? 'skipped: ' + c.json.skipped : c.json.checked + ' workspaces checked'})`) : fail(`Cron run failed (status ${c.status})`);
}

const w = await get('/api/webhooks/stripe', {method: 'POST', body: '{}', headers: {'content-type': 'application/json'}});
[400, 401, 403, 503].includes(w.status) ? pass(`Stripe webhook rejects unsigned requests (${w.status})`) : fail(`Stripe webhook answered ${w.status} to an unsigned request`);

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
