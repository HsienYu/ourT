/**
 * Unit tests for server/lib/lyrics-sync.js — LRC timestamp formatting,
 * parsing, word-level segment refinement, and the live offset shift used
 * by the "歌詞偏移" rehearsal control.
 *
 * Run: node --test tests/unit
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatLrcTimestamp,
  parseLrc,
  toLrc,
  segmentsToLrc,
  refineSegmentTimestamps,
  applyLrcOffset,
} = require('../../server/lib/lyrics-sync');

test('formatLrcTimestamp — formats mm:ss.xx correctly', () => {
  assert.equal(formatLrcTimestamp(0), '[00:00.00]');
  assert.equal(formatLrcTimestamp(83.4), '[01:23.40]');
  assert.equal(formatLrcTimestamp(59.999), '[01:00.00]'); // rounds up into next second boundary correctly via Math.round on centiseconds carrying
});

test('formatLrcTimestamp — clamps negative values to zero', () => {
  assert.equal(formatLrcTimestamp(-5), '[00:00.00]');
});

test('parseLrc — parses standard LRC lines and sorts by time', () => {
  const lrc = '[00:05.00]第二行\n[00:01.50]第一行\nnot a lyric line\n';
  const lines = parseLrc(lrc);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '第一行');
  assert.equal(lines[0].time, 1.5);
  assert.equal(lines[1].text, '第二行');
});

test('parseLrc — pads short millisecond fields correctly (2-digit centiseconds)', () => {
  const lines = parseLrc('[00:01.5]測試');
  assert.equal(lines[0].time, 1.5);
});

test('toLrc + parseLrc round-trip preserves time and text', () => {
  const original = [{ time: 12.34, text: '你好' }, { time: 0, text: '開始' }];
  const roundTripped = parseLrc(toLrc(original));
  assert.equal(roundTripped.length, 2);
  assert.ok(Math.abs(roundTripped[0].time - 0) < 0.01);
  assert.ok(Math.abs(roundTripped[1].time - 12.34) < 0.01);
});

test('segmentsToLrc — builds LRC text from Whisper segments', () => {
  const segments = [
    { start: 0, text: ' 第一句 ' },
    { start: 3.2, text: '第二句' },
  ];
  const lrc = segmentsToLrc(segments);
  assert.equal(lrc, '[00:00.00]第一句\n[00:03.20]第二句');
});

test('refineSegmentTimestamps — anchors segment start to first matching word start', () => {
  const segments = [
    { start: 1.0, end: 3.0, text: '你好世界' },
    { start: 3.0, end: 5.0, text: '再見' },
  ];
  const words = [
    { start: 1.35, end: 1.6, word: '你' }, // segment.start had ~0.35s leading silence
    { start: 1.6, end: 1.9, word: '好' },
    { start: 3.1, end: 3.4, word: '再' },
  ];
  const refined = refineSegmentTimestamps(segments, words);
  assert.equal(refined[0].start, 1.35, 'first segment should be anchored to the first word inside it');
  assert.equal(refined[1].start, 3.1, 'second segment should be anchored to its first word');
});

test('refineSegmentTimestamps — falls back to segment.start when no matching word exists', () => {
  const segments = [{ start: 10, end: 12, text: '沒有對應文字' }];
  const words = [{ start: 0.5, end: 0.8, word: '早' }]; // outside the segment window
  const refined = refineSegmentTimestamps(segments, words);
  assert.equal(refined[0].start, 10);
});

test('refineSegmentTimestamps — returns segments unchanged when words array is empty', () => {
  const segments = [{ start: 5, text: 'x' }];
  assert.deepEqual(refineSegmentTimestamps(segments, []), segments);
  assert.deepEqual(refineSegmentTimestamps(segments, undefined), segments);
});

test('applyLrcOffset — positive offset delays every line', () => {
  const lrc = '[00:01.00]甲\n[00:02.00]乙';
  const shifted = parseLrc(applyLrcOffset(lrc, 0.5));
  assert.ok(Math.abs(shifted[0].time - 1.5) < 0.01);
  assert.ok(Math.abs(shifted[1].time - 2.5) < 0.01);
});

test('applyLrcOffset — negative offset advances lines but never goes below zero', () => {
  const lrc = '[00:00.30]甲\n[00:05.00]乙';
  const shifted = parseLrc(applyLrcOffset(lrc, -1));
  assert.equal(shifted[0].time, 0, 'a line that would go negative clamps to 0');
  assert.ok(Math.abs(shifted[1].time - 4) < 0.01);
});

test('applyLrcOffset — zero/missing offset is a no-op', () => {
  const lrc = '[00:01.00]甲';
  assert.equal(applyLrcOffset(lrc, 0), lrc);
  assert.equal(applyLrcOffset(lrc, undefined), lrc);
});
