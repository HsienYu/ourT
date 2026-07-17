/**
 * song-importer.js
 *
 * Shared song import pipeline: download audio (yt-dlp) -> transcribe to
 * word-level-refined LRC (Whisper) -> add to catalog. Used by both the
 * server/scripts/import-song.js CLI and the /api/songs/import HTTP endpoint,
 * so there is exactly one implementation of this pipeline.
 *
 * Word-level timestamp accuracy: requests timestamp_granularities
 * ["word", "segment"] from the Whisper API (word timestamps incur extra
 * latency but no additional cost) and uses refineSegmentTimestamps() to
 * anchor each lyric line to its first word's actual start time rather than
 * the segment's start time, which often includes a little leading
 * silence/breath. This measurably tightens karaoke sync without any
 * runtime/UI changes — see lib/lyrics-sync.js for the pure logic.
 */

'use strict';

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getApiKey } = require('./settings');
const { segmentsToLrc, refineSegmentTimestamps } = require('./lyrics-sync');
const songQueue = require('./song-queue');
const { getSongsDir } = require('./song-storage');

const SONGS_DIR = getSongsDir();
const AUDIO_DIR = path.join(SONGS_DIR, 'audio');
const LYRICS_DIR = path.join(SONGS_DIR, 'lyrics');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]/g, (c) => c.codePointAt(0).toString(16))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function checkTool(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

/**
 * Transcribe via the OpenAI Whisper API with both word- and segment-level
 * timestamps. Returns { segments, words } — words may be an empty array if
 * the API/model doesn't return them for some reason, in which case callers
 * should fall back to segment-only timing.
 */
async function transcribeWithAPI(audioFile, apiKey) {
  const blob = new Blob([fs.readFileSync(audioFile)], { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', blob, path.basename(audioFile));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return { segments: json.segments || [], words: json.words || [] };
}

/**
 * Transcribe via the local `whisper` CLI (openai-whisper pip package).
 * Word-level timestamps aren't requested here (the local CLI's word-timing
 * output is less consistent across versions) — segment-level only, same as
 * before this change.
 */
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
    return { segments: data.segments || [], words: [] };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function getAudioDuration(audioFile) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioFile}"`,
      { encoding: 'utf8' },
    );
    return Math.round(parseFloat(out.trim()));
  } catch { return 0; }
}

/**
 * Run the full import pipeline: download audio, transcribe to a
 * word-timing-refined LRC, add a catalog entry.
 * @param {object} params
 * @param {string} params.url - YouTube (or any yt-dlp-supported) URL
 * @param {string} [params.title]
 * @param {string} [params.artist]
 * @param {string[]} [params.tags]
 * @param {(message: string) => void} [params.onProgress] - progress callback for job status
 * @returns {Promise<{ id: string, title: string, artist: string, audioPath: string, lrcPath: string }>}
 */
async function importSong({ url, title, artist, tags = [], onProgress = () => {} }) {
  if (!url) throw new Error('url is required');
  const resolvedTitle = title || '未知歌曲';
  const resolvedArtist = artist || '未知藝人';
  const id = `${slugify(resolvedArtist)}-${slugify(resolvedTitle)}-${Date.now().toString(36)}`;

  if (!checkTool('yt-dlp')) throw new Error('yt-dlp 未安裝（brew install yt-dlp）');
  if (!checkTool('ffmpeg')) throw new Error('ffmpeg 未安裝（brew install ffmpeg）');
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(LYRICS_DIR, { recursive: true });

  const audioPath = path.join(AUDIO_DIR, `${id}.mp3`);
  if (fs.existsSync(audioPath)) {
    onProgress('音訊已存在，略過下載');
  } else {
    onProgress('下載音訊中…');
    execFileSync('yt-dlp', [
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
      '--output', audioPath.replace('.mp3', '.%(ext)s'), url,
    ], { stdio: 'pipe' });
    onProgress('音訊下載完成');
  }

  const lrcPath = path.join(LYRICS_DIR, `${id}.lrc`);
  if (fs.existsSync(lrcPath)) {
    onProgress('歌詞已存在，略過轉錄');
  } else {
    onProgress('轉錄歌詞中…');
    const apiKey = getApiKey('openai');
    let transcription = null;

    if (apiKey) {
      try {
        transcription = await transcribeWithAPI(audioPath, apiKey);
        onProgress('已透過 OpenAI Whisper API 轉錄（含逐字時間戳記）');
      } catch (err) {
        onProgress(`Whisper API 失敗，改用本機辨識：${err.message}`);
      }
    }

    if (!transcription) {
      if (!checkTool('whisper')) {
        throw new Error('本機 whisper 未安裝（pip install openai-whisper），且未設定 OpenAI API key');
      }
      transcription = transcribeLocally(audioPath);
      onProgress('已透過本機 whisper 轉錄');
    }

    const refinedSegments = refineSegmentTimestamps(transcription.segments, transcription.words);
    fs.writeFileSync(lrcPath, segmentsToLrc(refinedSegments), 'utf8');
    onProgress('歌詞已儲存');
  }

  songQueue.addSongToCatalog({
    id,
    title: resolvedTitle,
    artist: resolvedArtist,
    duration: getAudioDuration(audioPath),
    tags,
    audioExt: 'mp3',
    coverExt: 'jpg',
    lrcOffset: 0,
  });
  onProgress('已加入歌曲目錄');

  return { id, title: resolvedTitle, artist: resolvedArtist, audioPath, lrcPath };
}

module.exports = {
  importSong,
  slugify,
  checkTool,
  getAudioDuration,
  transcribeWithAPI,
  transcribeLocally,
};
