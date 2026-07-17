/**
 * Unit tests for the catalog-writing helpers in server/lib/song-queue.js
 * (addSongToCatalog, updateSongOffset) added for the YouTube search/import
 * and live lyric-offset features. Uses an isolated temp catalog file per
 * test via OURT_SONGS_CATALOG_PATH so this never touches the real
 * songs/index.json.
 *
 * Run: node --test tests/unit
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshSongQueueModule(initialCatalog) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ourt-catalog-test-'));
  const catalogPath = path.join(dir, 'index.json');
  if (initialCatalog) fs.writeFileSync(catalogPath, JSON.stringify(initialCatalog), 'utf8');
  process.env.OURT_SONGS_CATALOG_PATH = catalogPath;
  const modulePath = require.resolve('../../server/lib/song-queue');
  delete require.cache[modulePath];
  return { songQueue: require(modulePath), catalogPath };
}

test('addSongToCatalog — appends a new entry and persists to disk', () => {
  const { songQueue, catalogPath } = freshSongQueueModule([]);
  const catalog = songQueue.addSongToCatalog({ id: 'song-1', title: 'A', artist: 'B', lrcOffset: 0 });
  assert.equal(catalog.length, 1);
  const onDisk = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].id, 'song-1');
});

test('addSongToCatalog — broadcasts catalog.updated only when the catalog changes', () => {
  const { songQueue } = freshSongQueueModule([]);
  const events = [];
  songQueue.init({ toAll: (event) => events.push(event) });

  songQueue.addSongToCatalog({ id: 'song-1', title: 'A' });
  songQueue.addSongToCatalog({ id: 'song-1', title: 'duplicate attempt' });

  assert.deepEqual(events, [{
    type: 'catalog.updated',
    catalog: [{ id: 'song-1', title: 'A' }],
  }]);
});

test('addSongToCatalog — is idempotent by id (does not duplicate)', () => {
  const { songQueue } = freshSongQueueModule([{ id: 'song-1', title: 'existing' }]);
  const catalog = songQueue.addSongToCatalog({ id: 'song-1', title: 'duplicate attempt' });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].title, 'existing', 'existing entry must not be overwritten');
});

test('updateSongOffset — updates lrcOffset and persists', () => {
  const { songQueue, catalogPath } = freshSongQueueModule([{ id: 'song-1', title: 'A', lrcOffset: 0 }]);
  const updated = songQueue.updateSongOffset('song-1', 0.35);
  assert.equal(updated.lrcOffset, 0.35);
  const onDisk = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.equal(onDisk[0].lrcOffset, 0.35);
});

test('updateSongOffset — returns null for an unknown song id, does not throw', () => {
  const { songQueue } = freshSongQueueModule([{ id: 'song-1' }]);
  const result = songQueue.updateSongOffset('does-not-exist', 0.1);
  assert.equal(result, null);
});

test('updateSongOffset — accepts negative offsets', () => {
  const { songQueue } = freshSongQueueModule([{ id: 'song-1', lrcOffset: 0 }]);
  const updated = songQueue.updateSongOffset('song-1', -0.5);
  assert.equal(updated.lrcOffset, -0.5);
});

test('endSong — clears now playing and broadcasts the authoritative queue state', () => {
  const { songQueue } = freshSongQueueModule([{ id: 'song-1', title: 'A' }]);
  const events = [];
  songQueue.init({ toAll: (event) => events.push(event), toProjection: (event) => events.push(event) });
  songQueue.enqueue('song-1', '觀眾');
  songQueue.dequeue();
  events.length = 0;

  const finished = songQueue.endSong();

  assert.equal(finished.song.id, 'song-1');
  assert.deepEqual(songQueue.getQueue(), { nowPlaying: null, upcoming: [] });
  assert.deepEqual(events, [
    { type: 'ktv.ended', item: finished },
    { type: 'queue.updated', queue: { nowPlaying: null, upcoming: [] } },
  ]);
});

test('skip — stops the current song and immediately plays the next queued song', () => {
  const { songQueue } = freshSongQueueModule([
    { id: 'song-1', title: 'A' },
    { id: 'song-2', title: 'B' },
  ]);
  const events = [];
  songQueue.init({ toAll: (event) => events.push(event), toProjection: (event) => events.push(event) });
  songQueue.enqueue('song-1', '觀眾');
  songQueue.enqueue('song-2', '觀眾');
  songQueue.dequeue();
  events.length = 0;

  const result = songQueue.skip();

  assert.equal(result.finished.song.id, 'song-1');
  assert.equal(result.item.song.id, 'song-2');
  assert.equal(songQueue.getQueue().nowPlaying.song.id, 'song-2');
  assert.deepEqual(events, [
    { type: 'queue.updated', queue: { nowPlaying: result.item, upcoming: [] } },
    { type: 'ktv.play', item: result.item },
  ]);
});

test('skip — ends playback when there is no next song', () => {
  const { songQueue } = freshSongQueueModule([{ id: 'song-1', title: 'A' }]);
  const events = [];
  songQueue.init({ toAll: (event) => events.push(event), toProjection: (event) => events.push(event) });
  songQueue.enqueue('song-1', '觀眾');
  songQueue.dequeue();
  events.length = 0;

  const result = songQueue.skip();

  assert.equal(result.finished.song.id, 'song-1');
  assert.equal(result.item, null);
  assert.deepEqual(songQueue.getQueue(), { nowPlaying: null, upcoming: [] });
  assert.deepEqual(events, [
    { type: 'queue.updated', queue: { nowPlaying: null, upcoming: [] } },
    { type: 'ktv.ended', item: result.finished },
  ]);
});

test('skip — does nothing when no song is playing', () => {
  const { songQueue } = freshSongQueueModule([]);
  assert.equal(songQueue.skip(), null);
});
