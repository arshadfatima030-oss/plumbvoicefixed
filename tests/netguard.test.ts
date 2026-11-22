import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {assertPublicHttpUrl, isPrivateIp, safeRequest} from '../server/netguard.ts';

test('isPrivateIp blocks private, metadata, mapped and documentation ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:808:808']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('assertPublicHttpUrl rejects bad schemes, credentials and private hosts', async () => {
  await assert.rejects(assertPublicHttpUrl('ftp://example.com'));
  await assert.rejects(assertPublicHttpUrl('https://user:pw@example.com'));
  await assert.rejects(assertPublicHttpUrl('http://localhost:3000'));
  await assert.rejects(assertPublicHttpUrl('http://127.0.0.1'));
  await assert.rejects(assertPublicHttpUrl('http://[::1]/'));
  await assert.rejects(assertPublicHttpUrl('http://http.example.com', {httpsOnly: true}));
});

test('safeRequest refuses a hostname that resolves to loopback at connect time (rebinding)', async () => {
  const srv = http.createServer((_q, r) => r.end('secret')).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = (srv.address() as {port: number}).port;
  try {
    // "localtest.me"-style names are not needed: 'localhost' resolves to loopback and must be refused by the connect-time lookup.
    await assert.rejects(safeRequest(new URL(`http://localhost:${port}/`), {timeoutMs: 3000}), /Private addresses/);
  } finally {
    srv.close();
  }
});
