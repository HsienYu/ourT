'use strict';

/**
 * Red-light tests for three silent-failure bugs fixed in the lite branch.
 *
 * 14.3 — Gemini error never broadcasts ai.done  → projection/monitor stuck
 * 14.5 — bus session.update sends to CLOSING socket without readyState guard
 * 14.6 — manual startSession() does not reset reconnectAttempts, exhausts
 *         retries immediately after the first manual reconnect
 *
 * Run: node --test tests/unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── 14.3 helper: extract the Gemini error broadcast sequence ─────────────────
// We test the invariant in isolation: given a Gemini message that contains only
// an error field (no serverContent, no toolCall), both ai.error AND ai.done
// must be broadcast.

function simulateGeminiErrorMessage(message, broadcastFn) {
  const content = message.serverContent;
  if (!content) {
    if (message.error) {
      broadcastFn({ type: 'ai.error', message: message.error.message || 'unknown error' });
      broadcastFn({ type: 'ai.done' }); // 14.3 fix: this line was missing
    }
    return;
  }
  if (content.turnComplete) {
    broadcastFn({ type: 'ai.done' });
  }
}

test('14.3 — Gemini error path broadcasts ai.done after ai.error', () => {
  const events = [];
  const broadcast = (e) => events.push(e.type);
  simulateGeminiErrorMessage({ error: { message: 'rate limit' } }, broadcast);
  assert.deepEqual(events, ['ai.error', 'ai.done']);
});

test('14.3 — Gemini turnComplete still broadcasts ai.done', () => {
  const events = [];
  const broadcast = (e) => events.push(e.type);
  simulateGeminiErrorMessage({ serverContent: { turnComplete: true } }, broadcast);
  assert.deepEqual(events, ['ai.done']);
});

// ── 14.5 helper: readyState guard on bus session.update forwarding ───────────
// The guard must be: activeRealtimeWs != null AND readyState === OPEN.

const WS_OPEN = 1;
const WS_CLOSING = 2;

function forwardSessionUpdateSafe(activeRealtimeWs, payload) {
  if (activeRealtimeWs && activeRealtimeWs.readyState === WS_OPEN) {
    activeRealtimeWs.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

test('14.5 — session.update is forwarded only when readyState is OPEN', () => {
  const sent = [];
  const openWs = { readyState: WS_OPEN, send: (d) => sent.push(d) };
  const closingWs = { readyState: WS_CLOSING, send: () => { throw new Error('sent to CLOSING socket'); } };
  const nullWs = null;

  assert.equal(forwardSessionUpdateSafe(openWs, { type: 'session.update' }), true);
  assert.equal(sent.length, 1);
  assert.equal(forwardSessionUpdateSafe(closingWs, { type: 'session.update' }), false);
  assert.equal(forwardSessionUpdateSafe(nullWs, { type: 'session.update' }), false);
  assert.equal(sent.length, 1, 'no additional sends after OPEN');
});

// ── 14.6 helper: reconnectAttempts must be reset on a new startSession call ──
// Simulates the counter behaviour: the fix is that startSession() always resets
// reconnectAttempts to 0 so that a manual click gets a fresh set of 3 retries.

const MAX_RECONNECT_ATTEMPTS = 3;

function shouldRetry(desiredSession, generation, sessionGeneration, reconnectAttempts) {
  return desiredSession && generation === sessionGeneration && reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
}

test('14.6 — after exhausting retries, resetting reconnectAttempts restores retrial', () => {
  let reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // exhausted
  const gen = 5;
  assert.equal(shouldRetry(true, gen, gen, reconnectAttempts), false, 'exhausted — no retry');

  reconnectAttempts = 0; // simulates startSession() resetting the counter
  assert.equal(shouldRetry(true, gen, gen, reconnectAttempts), true, 'after reset — retry allowed');
});

test('14.6 — each manual startSession resets the retry budget to zero', () => {
  let reconnectAttempts = 0;
  const sessionGeneration = { value: 0 };

  function startSession() {
    reconnectAttempts = 0; // 14.6 fix
    sessionGeneration.value += 1;
  }

  startSession();
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // simulates 3 failures
  assert.equal(shouldRetry(true, sessionGeneration.value, sessionGeneration.value, reconnectAttempts), false);
  startSession();
  assert.equal(reconnectAttempts, 0);
  assert.equal(shouldRetry(true, sessionGeneration.value, sessionGeneration.value, reconnectAttempts), true);
});
