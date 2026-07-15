/**
 * song-queue.js
 *
 * Manages the KTV song request queue and broadcasts state to all clients.
 * The broadcast bus is shared with the realtime proxy.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '../../songs/index.json');

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
  if (queue.length === 0) return null;
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
  }
  return finished;
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

module.exports = { init, getCatalog, enqueue, dequeue, endSong, getQueue, clearQueue };
