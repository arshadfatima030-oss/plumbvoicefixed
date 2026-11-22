import assert from 'node:assert/strict';
import test from 'node:test';
import {csrfVerdict, type CsrfInput} from '../server/csrf.ts';

const base: CsrfInput = {method: 'POST', path: '/leads', host: 'app.example.com', appUrl: 'https://app.example.com', production: true};
const ok = (o: Partial<CsrfInput>) => csrfVerdict({...base, ...o}).ok;

test('same-origin browser writes pass', () => {
  assert.equal(ok({origin: 'https://app.example.com'}), true);
  assert.equal(ok({referer: 'https://app.example.com/app/leads'}), true);
  assert.equal(ok({secFetchSite: 'same-origin'}), true);
  assert.equal(ok({origin: 'https://app.example.com', secFetchSite: 'same-origin'}), true);
});

test('cross-site, lookalike, null and insecure origins are blocked', () => {
  assert.equal(ok({origin: 'https://evil.com'}), false);
  assert.equal(ok({origin: 'https://app.example.com.evil.com'}), false);
  assert.equal(ok({origin: 'https://evilapp.example.com'}), false);
  assert.equal(ok({origin: 'null'}), false);
  assert.equal(ok({origin: 'http://app.example.com'}), false); // downgrade in production
  assert.equal(ok({referer: 'https://evil.com/page'}), false);
  assert.equal(ok({origin: 'https://app.example.com', secFetchSite: 'cross-site'}), false);
  assert.equal(ok({secFetchSite: 'cross-site'}), false);
});

test('a write with no Origin, Referer or same-origin proof is refused (was allowed before)', () => {
  assert.equal(ok({}), false);
  assert.equal(ok({secFetchSite: 'same-site'}), false); // sibling subdomains are not trusted
  assert.equal(ok({secFetchSite: 'none'}), false);
});

test('reads are untouched; signed webhooks, cron and the public widget are exempt', () => {
  assert.equal(ok({method: 'GET', origin: 'https://evil.com'}), true);
  assert.equal(ok({path: '/webhooks/stripe'}), true);
  assert.equal(ok({path: '/webhooks/telnyx/org1'}), true);
  assert.equal(ok({path: '/telnyx/texml/org1/tok'}), true);
  assert.equal(ok({path: '/cron/reminders'}), true);
  assert.equal(ok({path: '/tools/org1/missed-call'}), true); // AI assistant callbacks send no Origin
  assert.equal(ok({path: '/public/chat/org1', origin: 'https://customer-site.com'}), true);
});

test('login and other unauthenticated writes are protected too (login CSRF)', () => {
  assert.equal(ok({path: '/auth/login', origin: 'https://evil.com'}), false);
  assert.equal(ok({path: '/public/contact', origin: 'https://evil.com'}), false);
});

test('local development over http still works outside production', () => {
  const dev = {production: false, appUrl: undefined, host: 'localhost:3000'};
  assert.equal(ok({...dev, origin: 'http://localhost:3000'}), true);
  assert.equal(ok({...dev, origin: 'http://localhost:5173'}), false);
});
