/**
 * Unit tests for server/lib/voice-import-guard.js — caps how many
 * voice-triggered song imports (Workstream F: search_song / import_requested_song
 * tool calls) can run per server process ("per performance" in practice,
 * since a fresh run typically starts before/after each show).
 *
 * Run: node --test tests/unit
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canImport, recordImport, remainingImports, resetGuard, DEFAULT_MAX_IMPORTS } = require('../../server/lib/voice-import-guard');

test('canImport — allows imports under the default cap', () => {
  resetGuard();
  assert.equal(canImport(), true);
  assert.equal(remainingImports(), DEFAULT_MAX_IMPORTS);
});

test('recordImport — decrements remaining and eventually blocks further imports', () => {
  resetGuard();
  for (let i = 0; i < DEFAULT_MAX_IMPORTS; i += 1) {
    assert.equal(canImport(), true, `import ${i + 1} should still be allowed`);
    recordImport();
  }
  assert.equal(canImport(), false, 'import beyond the cap must be refused');
  assert.equal(remainingImports(), 0);
});

test('resetGuard — restores full capacity (used between server runs / tests)', () => {
  resetGuard();
  recordImport();
  recordImport();
  assert.equal(remainingImports(), DEFAULT_MAX_IMPORTS - 2);
  resetGuard();
  assert.equal(remainingImports(), DEFAULT_MAX_IMPORTS);
  assert.equal(canImport(), true);
});

test('canImport — respects a custom max passed in', () => {
  resetGuard();
  recordImport();
  recordImport();
  assert.equal(canImport(2), false, 'exactly at a custom cap of 2 must refuse');
  assert.equal(canImport(3), true, 'a higher custom cap still has room');
});
