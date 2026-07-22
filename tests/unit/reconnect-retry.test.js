'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldRetryDisconnect, retryDelayMs } = require('../../server/lib/reconnect-retry');

test('shouldRetryDisconnect — retries an unexpected current Gemini disconnect while desired', () => {
  assert.equal(shouldRetryDisconnect({ desired: true, generation: 3, activeGeneration: 3, attempts: 0 }), true);
});

test('shouldRetryDisconnect — never retries stale, stopped, or exhausted sessions', () => {
  assert.equal(shouldRetryDisconnect({ desired: false, generation: 3, activeGeneration: 3, attempts: 0 }), false);
  assert.equal(shouldRetryDisconnect({ desired: true, generation: 2, activeGeneration: 3, attempts: 0 }), false);
  assert.equal(shouldRetryDisconnect({ desired: true, generation: 3, activeGeneration: 3, attempts: 3 }), false);
});

test('retryDelayMs — uses bounded retry delays', () => {
  assert.equal(retryDelayMs(0), 750);
  assert.equal(retryDelayMs(1), 1500);
  assert.equal(retryDelayMs(99), 3000);
});
