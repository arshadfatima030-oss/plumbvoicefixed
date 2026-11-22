import test from 'node:test';
import assert from 'node:assert/strict';
import {fallbackHit, _resetFallback} from '../server/rateLimit.ts';

test('fallback counter increments within a window and resets after it', () => {
  _resetFallback();
  const t0 = 1_000_000;
  assert.equal(fallbackHit('k', 1000, t0).count, 1);
  assert.equal(fallbackHit('k', 1000, t0 + 10).count, 2);
  assert.equal(fallbackHit('k', 1000, t0 + 20).count, 3);
  assert.equal(fallbackHit('k', 1000, t0 + 1001).count, 1);
});

test('fallback counter keeps keys separate', () => {
  _resetFallback();
  fallbackHit('a', 1000, 5);
  assert.equal(fallbackHit('b', 1000, 5).count, 1);
});
