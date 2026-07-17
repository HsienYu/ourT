/**
 * Unit tests for packaged song storage. Packaged apps seed their writable
 * runtime songs directory once, while development continues using the source
 * songs directory.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { seedSongsDirectory } = require('../../server/lib/song-storage');

function makeSongsDir(root, songs) {
  fs.mkdirSync(path.join(root, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lyrics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(songs), 'utf8');
  fs.writeFileSync(path.join(root, 'lyrics', 'seed.lrc'), '[00:00.00]seed', 'utf8');
}

test('seedSongsDirectory — copies bundled catalog and media into an empty runtime directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ourt-song-storage-'));
  const bundled = path.join(root, 'bundled');
  const runtime = path.join(root, 'runtime');
  makeSongsDir(bundled, [{ id: 'seed' }]);
  fs.writeFileSync(path.join(bundled, 'audio', 'seed.mp3'), 'audio', 'utf8');

  seedSongsDirectory(bundled, runtime);

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtime, 'index.json'), 'utf8')), [{ id: 'seed' }]);
  assert.equal(fs.readFileSync(path.join(runtime, 'audio', 'seed.mp3'), 'utf8'), 'audio');
  assert.equal(fs.readFileSync(path.join(runtime, 'lyrics', 'seed.lrc'), 'utf8'), '[00:00.00]seed');
});

test('seedSongsDirectory — preserves imported runtime catalog and media on later launches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ourt-song-storage-'));
  const bundled = path.join(root, 'bundled');
  const runtime = path.join(root, 'runtime');
  makeSongsDir(bundled, [{ id: 'seed' }]);
  makeSongsDir(runtime, [{ id: 'imported' }]);
  fs.writeFileSync(path.join(runtime, 'audio', 'imported.mp3'), 'imported audio', 'utf8');

  seedSongsDirectory(bundled, runtime);

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtime, 'index.json'), 'utf8')), [{ id: 'imported' }]);
  assert.equal(fs.readFileSync(path.join(runtime, 'audio', 'imported.mp3'), 'utf8'), 'imported audio');
});

test('seedSongsDirectory — seeds into existing but catalog-less directory (upgrade from old app)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ourt-song-storage-'));
  const bundled = path.join(root, 'bundled');
  const runtime = path.join(root, 'runtime');
  makeSongsDir(bundled, [{ id: 'seed' }]);
  // Simulate old app that created the dir but left no catalog
  fs.mkdirSync(runtime, { recursive: true });

  seedSongsDirectory(bundled, runtime);

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtime, 'index.json'), 'utf8')), [{ id: 'seed' }]);
});
