#!/usr/bin/env node
/**
 * import-song.js
 *
 * Downloads a song from YouTube and generates an LRC lyrics file.
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
 *   - OpenAI API key in the ourT Settings panel (for Whisper API)
 *   - OR: pip install openai-whisper (for local fallback)
 */

'use strict';

const { execSync, execFileSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const { getApiKey, getSettings } = require('../lib/settings');

const SONGS_DIR  = path.join(__dirname, '../../songs');
const AUDIO_DIR  = path.join(SONGS_DIR, 'audio');
const LYRICS_DIR = path.join(SONGS_DIR, 'lyrics');
const CATALOG    = path.join(SONGS_DIR, 'index.json');

const OPENAI_API_KEY = getApiKey('openai');

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s) {
  return s.toLowerCase()
    .replace(/[\u4e00-\u9fff]/g, (c) => c.codePointAt(0).toString(16))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function checkTool(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

async function transcribeWithAPI(audioFile) {
  const blob = new Blob([fs.readFileSync(audioFile)], { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', blob, path.basename(audioFile));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.segments || [];
}

function transcribeLocally(audioFile) {
  const tmpDir = fs.mkdtempSync('/tmp/whisper-');
  try {
    execFileSync('whisper', [
      audioFile,
      '--model', 'small',
      '--language', 'zh',
      '--output_format', 'json',
      '--output_dir', tmpDir,
    ], { stdio: 'pipe' });
    const jsonFile = path.join(tmpDir, path.basename(audioFile).replace(/\.\w+$/, '.json'));
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    return data.segments || [];
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function segmentsToLrc(segments) {
  return segments.map((seg) => {
    const start = parseFloat(seg.start ?? seg.seek ?? 0);
    const mm  = String(Math.floor(start / 60)).padStart(2, '0');
    const ss  = String(Math.floor(start % 60)).padStart(2, '0');
    const ms  = String(Math.round((start % 1) * 100)).padStart(2, '0');
    return `[${mm}:${ss}.${ms}]${(seg.text || '').trim()}`;
  }).join('\n');
}

function getAudioDuration(audioFile) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioFile}"`,
      { encoding: 'utf8' }
    );
    return Math.round(parseFloat(out.trim()));
  } catch { return 0; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const id = `${slugify(artist)}-${slugify(title)}-${Date.now().toString(36)}`;
  console.log(`\n  Song ID: ${id}`);
  console.log(`  Title:   ${title}`);
  console.log(`  Artist:  ${artist}`);
  console.log('');

  // Step 1: Check tools
  if (!checkTool('yt-dlp')) { console.error('yt-dlp not found. Install: brew install yt-dlp'); process.exit(1); }
  if (!checkTool('ffmpeg'))  { console.error('ffmpeg not found. Install: brew install ffmpeg');  process.exit(1); }

  // Step 2: Download audio
  const audioPath = path.join(AUDIO_DIR, `${id}.mp3`);
  if (fs.existsSync(audioPath)) {
    console.log(`  [skip] Audio already exists: ${audioPath}`);
  } else {
    console.log('  [1/3] Downloading audio…');
    try {
      execFileSync('yt-dlp', [
        '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
        '--output', audioPath.replace('.mp3', '.%(ext)s'), url,
      ], { stdio: 'inherit' });
      console.log(`  [1/3] Saved: ${audioPath}`);
    } catch (e) {
      console.error('  [1/3] yt-dlp failed:', e.message); process.exit(1);
    }
  }

  // Step 3: Transcribe → LRC
  const lrcPath = path.join(LYRICS_DIR, `${id}.lrc`);
  if (fs.existsSync(lrcPath)) {
    console.log(`  [skip] LRC already exists: ${lrcPath}`);
  } else {
    console.log('  [2/3] Transcribing audio…');
    let segments = null;

    if (OPENAI_API_KEY) {
      try {
        segments = await transcribeWithAPI(audioPath);
        console.log('  [2/3] Transcribed via OpenAI Whisper API');
      } catch (e) {
        console.warn('  [2/3] Whisper API failed, trying local:', e.message);
      }
    }

    if (!segments) {
      if (!checkTool('whisper')) {
        console.error(
          '  [2/3] Local whisper not found.\n' +
          '  Install: pip install openai-whisper\n' +
          '  Or configure an OpenAI API key in the ourT Settings panel.'
        );
        process.exit(1);
      }
      segments = transcribeLocally(audioPath);
      console.log('  [2/3] Transcribed via local whisper');
    }

    fs.writeFileSync(lrcPath, segmentsToLrc(segments), 'utf8');
    console.log(`  [2/3] Saved LRC: ${lrcPath}`);
  }

  // Step 4: Update catalog
  console.log('  [3/3] Updating catalog…');
  let catalog = [];
  try { catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8')); } catch { catalog = []; }

  if (!catalog.find((s) => s.id === id)) {
    catalog.push({
      id, title, artist,
      duration: getAudioDuration(audioPath),
      tags, audioExt: 'mp3', coverExt: 'jpg', lrcOffset: 0,
    });
    fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2), 'utf8');
    console.log('  [3/3] Added to catalog.');
  } else {
    console.log('  [3/3] Already in catalog.');
  }

  // Step 5: Optionally pre-generate LLM variants
  if (forceGen || getSettings().ktv.autoRewrite) {
    console.log('\n  Running generate-lyrics.js…');
    try {
      execFileSync('node', [
        path.join(__dirname, 'generate-lyrics.js'), '--song', id,
      ], { stdio: 'inherit', cwd: __dirname });
    } catch (e) {
      console.warn('  generate-lyrics.js failed:', e.message);
    }
  }

  console.log(`\n  Done.\n    ID:    ${id}\n    Audio: songs/audio/${id}.mp3\n    LRC:   songs/lyrics/${id}.lrc\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
