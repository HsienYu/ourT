/**
 * Unit tests for the packaged-app expiry decision. The application may run
 * through 2026-09-01 local time and expires at the start of 2026-09-02.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILD_EXPIRY,
  isBuildExpired,
  nextExpiryCheckDelay,
} = require('../../ourT-electron/build-expiry');

test('isBuildExpired — permits packaged builds through 2026-09-01 local time', () => {
  assert.equal(isBuildExpired(true, new Date(2026, 8, 1, 23, 59, 59, 999)), false);
});

test('isBuildExpired — expires packaged builds at 2026-09-02 00:00 local time', () => {
  assert.equal(isBuildExpired(true, new Date(2026, 8, 2, 0, 0, 0, 0)), true);
  assert.equal(isBuildExpired(true, new Date(2026, 8, 2, 12, 0, 0, 0)), true);
});

test('isBuildExpired — leaves development startup available after expiry', () => {
  assert.equal(isBuildExpired(false, new Date(2026, 8, 3)), false);
});

test('nextExpiryCheckDelay — schedules an exact final check without exceeding one hour', () => {
  assert.equal(nextExpiryCheckDelay(new Date(2026, 8, 1, 23, 59, 59, 500)), 500);
  assert.equal(nextExpiryCheckDelay(new Date(2026, 7, 1, 0, 0, 0, 0)), 60 * 60 * 1000);
  assert.equal(nextExpiryCheckDelay(new Date(2026, 8, 2, 0, 0, 0, 0)), 0);
  assert.deepEqual(BUILD_EXPIRY, new Date(2026, 8, 2, 0, 0, 0, 0));
});
