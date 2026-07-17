/**
 * Resolves the one song-data directory used by the catalog, importer, and
 * media routes. Electron supplies OURT_SONGS_DIR for packaged installations
 * so imported media never writes into the read-only application bundle.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function getSongsDir() {
  return process.env.OURT_SONGS_DIR || path.join(__dirname, '../../songs');
}

function getCatalogPath() {
  return process.env.OURT_SONGS_CATALOG_PATH || path.join(getSongsDir(), 'index.json');
}

function seedSongsDirectory(bundledSongsDir, runtimeSongsDir) {
  if (fs.existsSync(runtimeSongsDir)) return;
  fs.mkdirSync(path.dirname(runtimeSongsDir), { recursive: true });
  fs.cpSync(bundledSongsDir, runtimeSongsDir, { recursive: true });
}

module.exports = { getSongsDir, getCatalogPath, seedSongsDirectory };
