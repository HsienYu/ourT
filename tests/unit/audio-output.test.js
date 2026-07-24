'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldFlushOutputBacklog,
  shouldWarnOutputBacklog,
  buildInputAudioConstraints,
  scheduleOutputChunk,
  rmsFromPcm16,
} = require('../../server/public/control/audio-output');

test('shouldFlushOutputBacklog — keeps normal provider lookahead queued', () => {
  assert.equal(shouldFlushOutputBacklog(0, 10), false);
  assert.equal(shouldFlushOutputBacklog(3, 10), false);
  assert.equal(shouldFlushOutputBacklog(10, 10), false);
});

test('shouldFlushOutputBacklog — never discards AI speech automatically', () => {
  assert.equal(shouldFlushOutputBacklog(10.01, 10), false);
  assert.equal(shouldFlushOutputBacklog(60, 10), false);
});

test('shouldWarnOutputBacklog — reports an excessive queue without discarding it', () => {
  assert.equal(shouldWarnOutputBacklog(10, 10), false);
  assert.equal(shouldWarnOutputBacklog(10.01, 10), true);
});

test('buildInputAudioConstraints — enables browser echo protection with or without a selected mic', () => {
  assert.deepEqual(buildInputAudioConstraints(), {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
  assert.deepEqual(buildInputAudioConstraints('mic-id'), {
    deviceId: { exact: 'mic-id' },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
});

test('scheduleOutputChunk — starts a response with a small jitter buffer', () => {
  assert.deepEqual(scheduleOutputChunk({
    currentTime: 5,
    nextTime: 0,
    duration: 0.2,
    startDelaySeconds: 0.12,
  }), { startAt: 5.12, nextTime: 5.32, recoveredFromUnderrun: false });
});

test('scheduleOutputChunk — preserves a queued response timeline without adding delay', () => {
  const schedule = scheduleOutputChunk({
    currentTime: 5.05,
    nextTime: 5.32,
    duration: 0.2,
    startDelaySeconds: 0.12,
  });
  assert.equal(schedule.startAt, 5.32);
  assert.ok(Math.abs(schedule.nextTime - 5.52) < 0.000001);
  assert.equal(schedule.recoveredFromUnderrun, false);
});

test('scheduleOutputChunk — rebuilds the jitter buffer after an output underrun', () => {
  assert.deepEqual(scheduleOutputChunk({
    currentTime: 6,
    nextTime: 5.32,
    duration: 0.2,
    startDelaySeconds: 0.12,
  }), { startAt: 6.12, nextTime: 6.32, recoveredFromUnderrun: true });
});

test('rmsFromPcm16 — calculates level from already-decoded samples', () => {
  assert.equal(rmsFromPcm16(new Int16Array()), 0);
  assert.ok(Math.abs(rmsFromPcm16(new Int16Array([32767, -32768])) - 1) < 0.001);
});
