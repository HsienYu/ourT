'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveLyricsVariant, validateRewriteLrc } = require('../../server/lib/lyrics-variant');

const original = '[00:01.00]第一句\n[00:03.00]第二句';

test('effectiveLyricsVariant — live override takes precedence over the persisted selection', () => {
  assert.equal(effectiveLyricsVariant({ activeLyricsVariant: 'emotional' }, true), 'live');
  assert.equal(effectiveLyricsVariant({ activeLyricsVariant: 'emotional' }, false), 'emotional');
  assert.equal(effectiveLyricsVariant({}, false), 'original');
});

test('validateRewriteLrc — accepts changed lyrics preserving every timestamp', () => {
  assert.doesNotThrow(() => validateRewriteLrc(original, '[00:01.00]改寫第一句\n[00:03.00]改寫第二句'));
});

test('validateRewriteLrc — rejects empty, unchanged, malformed, and timestamp-mismatched output', () => {
  for (const candidate of ['', original, '這不是 LRC', '[00:02.00]改寫第一句\n[00:03.00]改寫第二句']) {
    assert.throws(() => validateRewriteLrc(original, candidate));
  }
});
