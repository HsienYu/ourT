#!/usr/bin/env node
/**
 * import-song.js
 *
 * Downloads a song from YouTube and generates a word-timing-refined LRC
 * lyrics file. Thin CLI wrapper around lib/song-importer.js — the same
 * pipeline is also used by the POST /api/songs/import HTTP endpoint (the
 * search-and-import UI in /control), so there is exactly one implementation.
 *
 * Usage:
 *   node scripts/import-song.js \
 *     --url "https://youtube.com/watch?v=..." \
 *     --title "愛你" \
 *     --artist "張惠妹" \
 *     --tags "流行,愛情"
 *
 * Requirements:
 *   - yt-dlp installed: brew install yt-dlp
 *   - ffmpeg installed: brew install ffmpeg
 *   - OpenAI API key in the ourT Settings panel (for Whisper API, with
 *     word-level timestamps for tighter karaoke sync)
 *   - OR: pip install openai-whisper (for local fallback, segment-level only)
 */

'use strict';

const path = require('path');
const { importSong } = require('../lib/song-importer');
const { getSettings } = require('../lib/settings');
const { execFileSync } = require('child_process');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const url      = argValue('--url');
const title    = argValue('--title')  || '未知歌曲';
const artist   = argValue('--artist') || '未知藝人';
const tagsRaw  = argValue('--tags')   || '';
const tags     = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
const forceGen = args.includes('--generate-lyrics');

if (!url) {
  console.error('Usage: node import-song.js --url <youtube-url> --title <title> --artist <artist> [--tags tag1,tag2] [--generate-lyrics]');
  process.exit(1);
}

async function main() {
  console.log(`\n  Title:   ${title}`);
  console.log(`  Artist:  ${artist}`);
  console.log('');

  const result = await importSong({
    url, title, artist, tags,
    onProgress: (message) => console.log(`  ${message}`),
  });

  // Optionally pre-generate LLM variants
  if (forceGen || getSettings().ktv.autoRewrite) {
    console.log('\n  Running generate-lyrics.js…');
    try {
      execFileSync('node', [
        path.join(__dirname, 'generate-lyrics.js'), '--song', result.id,
      ], { stdio: 'inherit', cwd: __dirname });
    } catch (e) {
      console.warn('  generate-lyrics.js failed:', e.message);
    }
  }

  console.log(`\n  Done.\n    ID:    ${result.id}\n    Audio: songs/audio/${result.id}.mp3\n    LRC:   songs/lyrics/${result.id}.lrc\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
