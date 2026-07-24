'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldFlushOutputBacklog, rmsFromPcm16 } = require('../../server/public/control/audio-output');

test('shouldFlushOutputBacklog — keeps normal provider lookahead queued', () => {
  assert.equal(shouldFlushOutputBacklog(0, 10), false);
  assert.equal(shouldFlushOutputBacklog(3, 10), false);
  assert.equal(shouldFlushOutputBacklog(10, 10), false);
});

test('shouldFlushOutputBacklog — only flushes a runaway backlog', () => {
  assert.equal(shouldFlushOutputBacklog(10.01, 10), true);
});

test('rmsFromPcm16 — calculates level from already-decoded samples', () => {
  assert.equal(rmsFromPcm16(new Int16Array()), 0);
  assert.ok(Math.abs(rmsFromPcm16(new Int16Array([32767, -32768])) - 1) < 0.001);
});
