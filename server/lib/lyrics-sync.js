/**
 * lyrics-sync.js
 *
 * Pure LRC timing helpers, extracted so they can be unit tested without a
 * real Whisper API call or audio file. Covers:
 *  - formatting/parsing LRC timestamps
 *  - refining Whisper segment start times using word-level timestamps
 *    (segment.start includes leading silence/breath padding; the first
 *    word's actual start time is more precise for karaoke sync)
 *  - shifting an entire LRC file's timestamps by a fixed offset, for the
 *    live "歌詞偏移" (lyric offset) rehearsal control
 */

'use strict';

const LRC_LINE_RE = /^\[(\d{2}):(\d{2})\.(\d{1,3})\](.*)$/;

/**
 * Format a time in seconds as an LRC timestamp tag, e.g. 83.4 -> "[01:23.40]".
 * Clamps negative values to 0 (offsets should never push a line before the
 * start of the track). Rounds to whole centiseconds via a single integer
 * conversion so a centisecond value that rounds up to 100 correctly carries
 * into the next second (e.g. 59.999 -> "[01:00.00]", not the malformed
 * "[00:59.100]" a naive per-field Math.round would produce).
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatLrcTimestamp(totalSeconds) {
  const totalCentiseconds = Math.round(Math.max(0, totalSeconds) * 100);
  const cs = totalCentiseconds % 100;
  const totalWholeSeconds = Math.floor(totalCentiseconds / 100);
  const ss = totalWholeSeconds % 60;
  const mm = Math.floor(totalWholeSeconds / 60);
  return `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
}

/**
 * Parse LRC text into an array of { time (seconds), text } lines, sorted by
 * time. Non-timestamped lines (blank lines, comments) are dropped.
 * @param {string} lrcText
 * @returns {Array<{ time: number, text: string }>}
 */
function parseLrc(lrcText) {
  return String(lrcText || '')
    .split('\n')
    .map((line) => {
      const m = line.match(LRC_LINE_RE);
      if (!m) return null;
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      const ms = parseInt(m[3].padEnd(3, '0'), 10);
      return { time: mm * 60 + ss + ms / 1000, text: m[4] };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

/**
 * Serialize parsed lines back into LRC text.
 * @param {Array<{ time: number, text: string }>} lines
 * @returns {string}
 */
function toLrc(lines) {
  return lines.map(({ time, text }) => `${formatLrcTimestamp(time)}${text}`).join('\n');
}

/**
 * Build LRC text directly from Whisper segments (each with .start and .text).
 * @param {Array<{ start: number|string, text: string }>} segments
 * @returns {string}
 */
function segmentsToLrc(segments) {
  return toLrc((segments || []).map((seg) => ({
    time: parseFloat(seg.start ?? seg.seek ?? 0),
    text: (seg.text || '').trim(),
  })));
}

/**
 * Refine segment start times using word-level timestamps. Whisper's
 * segment.start often includes a little leading silence/breath before the
 * words actually begin; the first word within the segment's time window is
 * a tighter, more karaoke-accurate anchor. Falls back to the original
 * segment.start when no matching word is found or no words were provided
 * (e.g. timestamp_granularities didn't include "word").
 * @param {Array<{ start: number, end?: number, text: string }>} segments
 * @param {Array<{ start: number, end?: number, word: string }>} words
 * @returns {Array<{ start: number, end?: number, text: string }>}
 */
function refineSegmentTimestamps(segments, words) {
  if (!Array.isArray(words) || words.length === 0) return segments;
  const sortedWords = [...words].sort((a, b) => a.start - b.start);

  return (segments || []).map((seg) => {
    const segStart = parseFloat(seg.start ?? 0);
    const segEnd = parseFloat(seg.end ?? segStart + 1);
    // Small tolerance before segStart in case Whisper's word boundary lands
    // a few milliseconds earlier than its own segment boundary.
    const match = sortedWords.find((w) => w.start >= segStart - 0.15 && w.start < segEnd);
    return match ? { ...seg, start: match.start } : seg;
  });
}

/**
 * Shift every timestamp in an LRC file by a fixed offset (seconds).
 * Positive offset delays lyrics (they appear later); negative advances them.
 * Used by the live "歌詞偏移" rehearsal slider.
 * @param {string} lrcText
 * @param {number} offsetSeconds
 * @returns {string}
 */
function applyLrcOffset(lrcText, offsetSeconds) {
  const offset = Number(offsetSeconds) || 0;
  return toLrc(parseLrc(lrcText).map(({ time, text }) => ({ time: time + offset, text })));
}

module.exports = {
  formatLrcTimestamp,
  parseLrc,
  toLrc,
  segmentsToLrc,
  refineSegmentTimestamps,
  applyLrcOffset,
};
