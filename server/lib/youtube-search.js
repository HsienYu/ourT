/**
 * youtube-search.js
 *
 * Search YouTube via yt-dlp's built-in ytsearch — no YouTube Data API key
 * required. Uses --flat-playlist so the search results page itself is
 * parsed without yt-dlp fetching each individual video's full page (much
 * faster for an interactive search-as-you-go UI; the full metadata is
 * fetched anyway during the actual download step in song-importer.js).
 */

'use strict';

const { execFile } = require('child_process');

const DEFAULT_LIMIT = 6;
const SEARCH_TIMEOUT_MS = 20000;

/**
 * Pick a reasonably-sized thumbnail from yt-dlp's thumbnails array. Prefers
 * a middling resolution over the largest/smallest available.
 * @param {Array<{url: string, width?: number}>} thumbnails
 * @returns {string}
 */
function pickThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return '';
  const sorted = [...thumbnails].sort((a, b) => (a.width || 0) - (b.width || 0));
  const mid = sorted[Math.floor(sorted.length / 2)];
  return (mid && mid.url) || sorted[sorted.length - 1].url || '';
}

/**
 * Parse yt-dlp's --dump-json output (one JSON object per line, one line per
 * search result) into a simplified result list for the control panel UI.
 * @param {string} stdout
 * @returns {Array<{videoId: string, title: string, channel: string, durationSeconds: number, thumbnailUrl: string, url: string}>}
 */
function parseYtDlpSearchOutput(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let obj;
      try { obj = JSON.parse(line); } catch { return null; }
      if (!obj || !obj.id) return null;
      return {
        videoId: obj.id,
        title: obj.title || '未知標題',
        channel: obj.channel || obj.uploader || '',
        durationSeconds: Number(obj.duration) || 0,
        thumbnailUrl: obj.thumbnail || pickThumbnail(obj.thumbnails),
        url: obj.webpage_url || obj.url || `https://www.youtube.com/watch?v=${obj.id}`,
      };
    })
    .filter(Boolean);
}

/**
 * Search YouTube for a query string, no API key required.
 * @param {string} query
 * @param {number} limit
 * @param {(cmd: string, args: string[], opts: object, cb: Function) => void} execFileImpl - injectable for tests
 * @returns {Promise<Array<object>>}
 */
function searchYoutube(query, limit = DEFAULT_LIMIT, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    if (!query || !query.trim()) {
      reject(new Error('search query is required'));
      return;
    }
    const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), 20);
    execFileImpl(
      'yt-dlp',
      ['--no-download', '--flat-playlist', '--dump-json', `ytsearch${safeLimit}:${query}`],
      { maxBuffer: 10 * 1024 * 1024, timeout: SEARCH_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ENOENT') {
            reject(new Error('yt-dlp 找不到。請先執行：brew install yt-dlp，然後重新開啟 ourT。'));
            return;
          }
          reject(new Error(stderr?.toString().trim() || err.message));
          return;
        }
        resolve(parseYtDlpSearchOutput(stdout));
      },
    );
  });
}

module.exports = { searchYoutube, parseYtDlpSearchOutput, pickThumbnail };
