import assert from 'node:assert/strict';
import test from 'node:test';
import {openRecording, parseRecordingUrl, recordingHosts, safeRange} from '../server/recordings.ts';

const hosts = ['telnyx.com', 'amazonaws.com'];

test('parseRecordingUrl accepts only https URLs on allowlisted hosts', () => {
  assert.ok(parseRecordingUrl('https://s3.amazonaws.com/bucket/rec.mp3?X-Amz-Signature=abc', hosts));
  assert.ok(parseRecordingUrl('https://api.telnyx.com/v2/recordings/1/download', hosts));
  for (const bad of [
    'http://s3.amazonaws.com/rec.mp3', // not https
    'https://evil.com/rec.mp3',
    'https://amazonaws.com.evil.com/rec.mp3', // suffix trick
    'https://notamazonaws.com/rec.mp3',
    'https://user:pw@s3.amazonaws.com/rec.mp3', // credentials
    'https://s3.amazonaws.com:8443/rec.mp3', // odd port
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/x',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.equal(parseRecordingUrl(bad, hosts), null, bad);
  }
});

test('RECORDING_HOST_ALLOWLIST overrides the defaults', () => {
  assert.deepEqual(recordingHosts('Rec.Example.com, .cdn.example.org'), ['rec.example.com', 'cdn.example.org']);
  assert.ok(recordingHosts('').length > 0);
});

test('safeRange forwards one simple byte range and nothing else', () => {
  assert.equal(safeRange('bytes=0-'), 'bytes=0-');
  assert.equal(safeRange('bytes=100-200'), 'bytes=100-200');
  assert.equal(safeRange('bytes=-500'), 'bytes=-500');
  for (const bad of ['bytes=0-1,5-9', 'bytes=-', 'items=0-5', 'bytes=0-1\r\nX: y', undefined, 5]) assert.equal(safeRange(bad), undefined);
});

test('openRecording refuses non-allowlisted and private targets before any download', async () => {
  await assert.rejects(openRecording('https://evil.com/rec.mp3', undefined, hosts), /not allowed/);
  // An allowlisted name that points at a private address is still refused (DNS-rebinding style defence).
  await assert.rejects(openRecording('https://localhost/rec.mp3', undefined, ['localhost']), /Private addresses/);
});
