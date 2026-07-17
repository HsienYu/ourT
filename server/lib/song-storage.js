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

/**
 * Copy bundled songs into the writable runtime directory on first launch.
 * Skips when index.json already exists (user has their own catalog).
 * Checks the catalog file rather than the directory so that an existing-but-empty
 * runtime dir (e.g. left over from a previous version) is still seeded correctly.
 */
function seedSongsDirectory(bundledSongsDir, runtimeSongsDir) {
  const runtimeCatalog = path.join(runtimeSongsDir, 'index.json');
  if (fs.existsSync(runtimeCatalog)) return;
  fs.mkdirSync(runtimeSongsDir, { recursive: true });
  fs.cpSync(bundledSongsDir, runtimeSongsDir, { recursive: true });
}

module.exports = { getSongsDir, getCatalogPath, seedSongsDirectory };
