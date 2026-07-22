/**
 * song-queue.js
 *
 * Manages the KTV song request queue and broadcasts state to all clients.
 * The broadcast bus is shared with the realtime proxy.
 */

'use strict';

const fs = require('fs');
const { getCatalogPath } = require('./song-storage');

// Overridable for tests (OURT_SONGS_CATALOG_PATH) so unit tests never touch
// the real songs/index.json — same pattern as OURT_SETTINGS_PATH in settings.js.
const CATALOG_PATH = getCatalogPath();

let queue = [];       // Array of song request objects
let nowPlaying = null;
let broadcast = null; // injected broadcast bus

function init(broadcastBus) {
  broadcast = broadcastBus;
}

function loadCatalog() {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function getCatalog() {
  return loadCatalog();
}

function saveCatalog(catalog) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
}

/**
 * Append a new song entry to the catalog (idempotent by id).
 * @param {object} entry - full catalog entry, must include `id`
 * @returns {object[]} the updated catalog
 */
function addSongToCatalog(entry) {
  const catalog = loadCatalog();
  if (!catalog.find((s) => s.id === entry.id)) {
    catalog.push(entry);
    saveCatalog(catalog);
    if (broadcast) {
      broadcast.toAll({ type: 'catalog.updated', catalog });
    }
  }
  return catalog;
}

/**
 * Update a song's lrcOffset (seconds), used by the live "歌詞偏移" rehearsal
 * control in /control to fine-tune sync without re-importing.
 * @param {string} songId
 * @param {number} lrcOffset - seconds, positive delays lyrics
 * @returns {object|null} the updated song entry, or null if not found
 */
function updateSongOffset(songId, lrcOffset) {
  const catalog = loadCatalog();
  const song = catalog.find((s) => s.id === songId);
  if (!song) return null;
  song.lrcOffset = lrcOffset;
  saveCatalog(catalog);
  return song;
}

function updateSongLyricsVariant(songId, activeLyricsVariant) {
  const catalog = loadCatalog();
  const song = catalog.find((entry) => entry.id === songId);
  if (!song) return null;
  song.activeLyricsVariant = activeLyricsVariant;
  saveCatalog(catalog);
  for (const item of [...queue, nowPlaying].filter(Boolean)) {
    if (item.song.id === songId) item.song.activeLyricsVariant = activeLyricsVariant;
  }
  return song;
}

function enqueue(songId, requesterLabel) {
  const catalog = loadCatalog();
  const song = catalog.find((s) => s.id === songId);
  if (!song) return { ok: false, error: 'song not found' };

  const item = {
    id: Date.now().toString(),
    song,
    requesterLabel: requesterLabel || '觀眾',
    requestedAt: new Date().toISOString(),
  };
  queue.push(item);

  if (broadcast) {
    broadcast.toAll({ type: 'queue.updated', queue: getQueue() });
  }
  return { ok: true, item };
}

function dequeue() {
  if (nowPlaying || queue.length === 0) return null;
  nowPlaying = queue.shift();
  if (broadcast) {
    broadcast.toAll({ type: 'queue.updated', queue: getQueue() });
    broadcast.toProjection({ type: 'ktv.play', item: nowPlaying });
  }
  return nowPlaying;
}

function endSong() {
  const finished = nowPlaying;
  nowPlaying = null;
  if (broadcast) {
    broadcast.toAll({ type: 'ktv.ended', item: finished });
    broadcast.toAll({ type: 'queue.updated', queue: getQueue() });
  }
  return finished;
}

/**
 * Skip the current song and immediately advance to the next request when
 * available. This produces one authoritative queue state for all clients.
 * @returns {{ finished: object, item: object|null }|null}
 */
function skip() {
  if (!nowPlaying) return null;
  const finished = nowPlaying;
  nowPlaying = queue.shift() || null;
  if (broadcast) {
    broadcast.toAll({ type: 'queue.updated', queue: getQueue() });
    if (nowPlaying) broadcast.toProjection({ type: 'ktv.play', item: nowPlaying });
    else broadcast.toAll({ type: 'ktv.ended', item: finished });
  }
  return { finished, item: nowPlaying };
}

function getQueue() {
  return { nowPlaying, upcoming: queue };
}

function clearQueue() {
  queue = [];
  nowPlaying = null;
  if (broadcast) {
    broadcast.toAll({ type: 'queue.updated', queue: getQueue() });
  }
}

module.exports = {
  init, getCatalog, enqueue, dequeue, endSong, skip, getQueue, clearQueue,
  addSongToCatalog, updateSongOffset, updateSongLyricsVariant,
};
