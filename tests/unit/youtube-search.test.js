/**
 * Unit tests for server/lib/youtube-search.js — parses yt-dlp's --dump-json
 * search output (no real network/yt-dlp calls; execFile is mocked).
 *
 * Run: node --test tests/unit
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { searchYoutube, parseYtDlpSearchOutput, pickThumbnail } = require('../../server/lib/youtube-search');

test('parseYtDlpSearchOutput — parses newline-delimited JSON into simplified results', () => {
  const stdout = [
    JSON.stringify({ id: 'abc123', title: '稻香', channel: '周杰倫', duration: 223, thumbnail: 'https://x/thumb.jpg' }),
    JSON.stringify({ id: 'def456', title: '晴天', uploader: 'JVR Music', duration: 269 }),
  ].join('\n');

  const results = parseYtDlpSearchOutput(stdout);
  assert.equal(results.length, 2);
  assert.equal(results[0].videoId, 'abc123');
  assert.equal(results[0].title, '稻香');
  assert.equal(results[0].channel, '周杰倫');
  assert.equal(results[0].durationSeconds, 223);
  assert.equal(results[0].thumbnailUrl, 'https://x/thumb.jpg');
  assert.equal(results[1].channel, 'JVR Music', 'falls back to uploader when channel is absent');
});

test('parseYtDlpSearchOutput — skips malformed lines and entries without an id', () => {
  const stdout = [
    'not json at all',
    JSON.stringify({ title: 'missing id field' }),
    JSON.stringify({ id: 'ok1', title: 'valid entry' }),
    '',
  ].join('\n');
  const results = parseYtDlpSearchOutput(stdout);
  assert.equal(results.length, 1);
  assert.equal(results[0].videoId, 'ok1');
});

test('parseYtDlpSearchOutput — defaults missing fields sensibly', () => {
  const results = parseYtDlpSearchOutput(JSON.stringify({ id: 'x' }));
  assert.equal(results[0].title, '未知標題');
  assert.equal(results[0].channel, '');
  assert.equal(results[0].durationSeconds, 0);
  assert.equal(results[0].url, 'https://www.youtube.com/watch?v=x');
});

test('pickThumbnail — picks a middling resolution, not the largest or smallest', () => {
  const thumbnails = [
    { url: 'small.jpg', width: 120 },
    { url: 'medium.jpg', width: 480 },
    { url: 'large.jpg', width: 1280 },
  ];
  assert.equal(pickThumbnail(thumbnails), 'medium.jpg');
});

test('pickThumbnail — handles empty/missing input gracefully', () => {
  assert.equal(pickThumbnail([]), '');
  assert.equal(pickThumbnail(undefined), '');
});

test('searchYoutube — rejects on empty query without invoking execFile', () => {
  let called = false;
  const fakeExecFile = () => { called = true; };
  return searchYoutube('', 5, fakeExecFile).then(
    () => assert.fail('should have rejected'),
    (err) => {
      assert.match(err.message, /required/);
      assert.equal(called, false);
    },
  );
});

test('searchYoutube — builds the correct ytsearchN: query and parses results', async () => {
  let capturedArgs = null;
  const fakeExecFile = (cmd, args, opts, cb) => {
    capturedArgs = args;
    assert.equal(cmd, 'yt-dlp');
    cb(null, JSON.stringify({ id: 'zzz', title: '測試歌曲' }), '');
  };
  const results = await searchYoutube('測試 歌曲', 3, fakeExecFile);
  assert.ok(capturedArgs.includes('ytsearch3:測試 歌曲'));
  assert.equal(results.length, 1);
  assert.equal(results[0].videoId, 'zzz');
});

test('searchYoutube — clamps limit into a sane range', async () => {
  let capturedArgs = null;
  const fakeExecFile = (cmd, args, opts, cb) => { capturedArgs = args; cb(null, '', ''); };
  await searchYoutube('x', 500, fakeExecFile);
  assert.ok(capturedArgs.some((a) => a.startsWith('ytsearch20:')), 'limit should be clamped to a maximum of 20');
});

test('searchYoutube — rejects with stderr message on yt-dlp failure', () => {
  const fakeExecFile = (cmd, args, opts, cb) => cb(new Error('exit 1'), '', 'yt-dlp: command not found');
  return searchYoutube('x', 5, fakeExecFile).then(
    () => assert.fail('should have rejected'),
    (err) => assert.match(err.message, /command not found/),
  );
});
