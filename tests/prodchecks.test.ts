import assert from 'node:assert/strict';
import test from 'node:test';
import {productionConfigReport} from '../server/prodChecks.ts';

const good = {
  APP_URL: 'https://app.example.com', DATABASE_URL: 'postgres://u:p@db.example.com:5432/app?sslmode=require', SECRETS_KEY: 'x'.repeat(48), SENDGRID_API_KEY: 'k', MAIL_FROM: 'a@b.com',
  CRON_SECRET: 'c'.repeat(24), STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'w', STRIPE_PRICE_STARTER: 'p1', STRIPE_PRICE_PROFESSIONAL: 'p2', STRIPE_PRICE_BUSINESS: 'p3',
  TELNYX_API_KEY: 't', TELNYX_PUBLIC_KEY: 'p', TRUST_PROXY: '1',
};

test('a complete production config has no findings', () => {
  assert.deepEqual(productionConfigReport(good), {fatal: [], warnings: []});
});

test('insecure cookie or http APP_URL stop the server from starting', () => {
  assert.equal(productionConfigReport({...good, COOKIE_SECURE: 'false'}).fatal.length, 1);
  assert.equal(productionConfigReport({...good, APP_URL: 'http://app.example.com'}).fatal.length, 1);
  assert.equal(productionConfigReport({...good, COOKIE_SECURE: 'true'}).fatal.length, 0);
});

test('missing or weak settings are reported as warnings', () => {
  const w = productionConfigReport({}).warnings.join('\n');
  for (const k of ['APP_URL', 'DATABASE_URL', 'SECRETS_KEY', 'SENDGRID_API_KEY', 'CRON_SECRET', 'TRUST_PROXY']) assert.ok(w.includes(k), k);
  assert.ok(productionConfigReport({...good, SECRETS_KEY: 'short-key-1234567'}).warnings.some((x) => x.includes('32')));
  assert.ok(productionConfigReport({...good, STRIPE_PRICE_BUSINESS: ''}).warnings.some((x) => x.includes('STRIPE_PRICE_BUSINESS')));
  assert.ok(productionConfigReport({...good, STRIPE_SECRET_KEY: 'sk_test_abc'}).warnings.some((x) => x.includes('TEST key')));
  assert.ok(productionConfigReport({...good, TELNYX_PUBLIC_KEY: ''}).warnings.some((x) => x.includes('TELNYX_PUBLIC_KEY')));
  assert.ok(productionConfigReport({...good, TRUST_PROXY: 'true'}).warnings.some((x) => x.includes('every proxy')));
});

test('database SSL findings', () => {
  const remote = {...good, DATABASE_URL: 'postgres://u:p@db.example.com:5432/app'};
  assert.ok(productionConfigReport(remote).warnings.some((x) => x.includes('SSL is not enabled')));
  assert.equal(productionConfigReport({...remote, DATABASE_SSL: 'true'}).warnings.length, 0);
  assert.equal(productionConfigReport({...remote, DATABASE_URL: remote.DATABASE_URL + '?sslmode=require'}).warnings.length, 0);
  assert.ok(productionConfigReport({...remote, DATABASE_SSL: 'true', DATABASE_SSL_REJECT_UNAUTHORIZED: 'false'}).warnings.some((x) => x.includes('certificate')));
});

test('disabling the TeXML signature requirement is flagged as a warning', () => {
  const r = productionConfigReport({...good, TEXML_REQUIRE_SIGNATURE: 'false'});
  assert.ok(r.warnings.some((w) => w.includes('TEXML_REQUIRE_SIGNATURE=false')));
  assert.ok(!productionConfigReport(good).warnings.some((w) => w.includes('TEXML_REQUIRE_SIGNATURE')));
});
