'use strict';

// The packaged application is usable through 2026-09-01 local time.
const BUILD_EXPIRY = new Date(2026, 8, 2, 0, 0, 0, 0);
const MAX_EXPIRY_CHECK_DELAY_MS = 60 * 60 * 1000;

function isBuildExpired(isPackaged, now = new Date()) {
  return isPackaged && now >= BUILD_EXPIRY;
}

function nextExpiryCheckDelay(now = new Date()) {
  return Math.min(Math.max(BUILD_EXPIRY.getTime() - now.getTime(), 0), MAX_EXPIRY_CHECK_DELAY_MS);
}

module.exports = { BUILD_EXPIRY, isBuildExpired, nextExpiryCheckDelay };
