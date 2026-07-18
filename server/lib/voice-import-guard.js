/**
 * voice-import-guard.js
 *
 * Caps how many voice-triggered song imports (Workstream F: the
 * import_requested_song tool call, intercepted in realtime-proxy.js) can run
 * per server process. Each import spawns yt-dlp + Whisper (30-90s), so an
 * unbounded number of repeated voice requests could consume real time/cost
 * during a live show — this is a deliberate, small, explicit limit, separate
 * from the operator-driven /control search+import UI (which has no cap).
 *
 * Module-level state (not per-connection) is intentional: the cap is meant
 * to apply "per performance," and a fresh server run typically starts before
 * each show/rehearsal — resetGuard() exists for tests and for an operator who
 * explicitly wants to reset the count without restarting the whole app.
 */

'use strict';

const DEFAULT_MAX_IMPORTS = 5;

let importCount = 0;

/**
 * @param {number} [maxImports] - defaults to DEFAULT_MAX_IMPORTS
 * @returns {boolean} true if another import is still allowed
 */
function canImport(maxImports = DEFAULT_MAX_IMPORTS) {
  return importCount < maxImports;
}

/** Record that a voice-triggered import was started. */
function recordImport() {
  importCount += 1;
}

/**
 * @param {number} [maxImports] - defaults to DEFAULT_MAX_IMPORTS
 * @returns {number} imports still allowed before the cap is hit
 */
function remainingImports(maxImports = DEFAULT_MAX_IMPORTS) {
  return Math.max(0, maxImports - importCount);
}

/** Reset the counter — used by tests and available for an explicit operator reset. */
function resetGuard() {
  importCount = 0;
}

module.exports = { canImport, recordImport, remainingImports, resetGuard, DEFAULT_MAX_IMPORTS };
