#!/usr/bin/env node
/**
 * generate-lyrics.js
 *
 * Pre-generates LLM-modified lyric variants for all songs in the catalog.
 * Run this BEFORE the performance to avoid real-time API latency.
 *
 * Usage:
 *   cd server
 *   node scripts/generate-lyrics.js [--song <id>] [--variant <name>]
 *
 * Outputs: songs/lyrics/<id>.<variant>.lrc
 *   e.g.   songs/lyrics/song-001.gender-swap.lrc
 *          songs/lyrics/song-001.emotional.lrc
 *          songs/lyrics/song-001.distorted.lrc
 *
 * The original songs/lyrics/<id>.lrc is never modified.
 *
 * Variants:
 *   gender-swap  — swap gendered words (他/她, 男/女, 哥/姐, etc.)
 *   emotional    — rewrite lines to heighten emotional intensity
 *   distorted    — surrealist / poetic distortion
 *   custom       — free-form prompt provided via --prompt "..."
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { getApiKey } = require('../lib/settings');

const SONGS_DIR  = path.join(__dirname, '../../songs');
const LYRICS_DIR = path.join(SONGS_DIR, 'lyrics');
const CATALOG    = path.join(SONGS_DIR, 'index.json');

const CLAUDE_API_KEY = getApiKey('anthropic');
if (!CLAUDE_API_KEY) {
  console.error('ERROR: Anthropic API key not set in the ourT Settings panel');
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const targetSong    = argValue(args, '--song');
const targetVariant = argValue(args, '--variant') || 'all';
const customPrompt  = argValue(args, '--prompt');

function argValue(arr, flag) {
  const i = arr.indexOf(flag);
  return i !== -1 && arr[i + 1] ? arr[i + 1] : null;
}

const VARIANTS = {
  'gender-swap': {
    label: '性別互換',
    systemPrompt: `你是一位繁體中文歌詞改編者，專門進行性別詞語的互換改編。
規則：
1. 將「他」改為「她」，「她」改為「他」（並可改為「TA」以去性別化）
2. 將男性化詞語替換為女性化，反之亦然（例：哥→姐、男孩→女孩、先生→女士）
3. 可將無性別詞語改為流動性別的表達（如「你」保持中性）
4. 保持原句的韻律節拍和音節數量不變
5. 若原句沒有性別詞語，可加入對性別的模糊或詩意描述
6. 輸出格式完全與輸入 LRC 格式相同，時間戳記不可改動`,
  },
  'emotional': {
    label: '情緒放大',
    systemPrompt: `你是一位繁體中文詩人，將歌詞進行情緒強化改寫。
規則：
1. 保留原句的核心意象，但將情緒強度放大 2–3 倍
2. 使用更具衝擊力、原始、或脆弱的詞語
3. 允許加入身體感知（如「喉嚨發緊」、「胸口空洞」）
4. 保持原句的音節數量（±2 字）
5. 輸出格式完全與輸入 LRC 格式相同，時間戳記不可改動`,
  },
  'distorted': {
    label: '超現實扭曲',
    systemPrompt: `你是一位超現實主義繁體中文詩人，將歌詞進行詩意的扭曲與異化。
規則：
1. 打破語義邏輯——詞語組合應產生陌生感
2. 可使用不完整的句子、重複、或突然的斷裂
3. 引入不相關但詩意的意象（天氣、動物、數字、顏色）
4. 保持大致相同的音節數（可多或少 3–5 字）
5. 目標是讓聽者感到「熟悉又陌生」
6. 輸出格式完全與輸入 LRC 格式相同，時間戳記不可改動`,
  },
};

// ── LRC parsing / serialization ───────────────────────────────────────────────
function parseLrc(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(\[\d{2}:\d{2}\.\d{1,3}\])(.*)$/);
    if (m) {
      lines.push({ timestamp: m[1], text: m[2].trim() });
    }
  }
  return lines;
}

function serializeLrc(lines) {
  return lines.map((l) => `${l.timestamp}${l.text}`).join('\n');
}

// ── Claude call ───────────────────────────────────────────────────────────────
async function transformLyrics(lrcText, variant, songTitle, artist) {
  const parsed = parseLrc(lrcText);
  if (!parsed.length) throw new Error('No LRC lines found');

  const variantDef = VARIANTS[variant];
  const systemPrompt = variant === 'custom' && customPrompt
    ? customPrompt
    : variantDef?.systemPrompt;

  if (!systemPrompt) throw new Error(`Unknown variant: ${variant}`);

  // Send only the lyric text lines (timestamps preserved separately for safety)
  const linesOnly = parsed.map((l) => `${l.timestamp}${l.text}`).join('\n');

  const userPrompt =
    `歌曲：《${songTitle}》 ${artist}\n\n` +
    `以下是原始 LRC 歌詞，請按照你的改編規則輸出改編後的版本。\n` +
    `只輸出 LRC 內容，不要任何額外說明：\n\n${linesOnly}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const json = await res.json();
  return json.content?.[0]?.text || '';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const songs = targetSong
    ? catalog.filter((s) => s.id === targetSong)
    : catalog;

  if (!songs.length) {
    console.error(`No songs found${targetSong ? ` with id: ${targetSong}` : ''}`);
    process.exit(1);
  }

  const variantKeys = targetVariant === 'all'
    ? Object.keys(VARIANTS)
    : [targetVariant];

  for (const song of songs) {
    const lrcPath = path.join(LYRICS_DIR, `${song.id}.lrc`);
    if (!fs.existsSync(lrcPath)) {
      console.log(`[skip] ${song.id}: no .lrc file found at ${lrcPath}`);
      continue;
    }

    const originalLrc = fs.readFileSync(lrcPath, 'utf8');
    console.log(`\n=== ${song.title} — ${song.artist} ===`);

    for (const variant of variantKeys) {
      const outPath = path.join(LYRICS_DIR, `${song.id}.${variant}.lrc`);

      // Skip if already generated (use --force to regenerate)
      if (fs.existsSync(outPath) && !args.includes('--force')) {
        console.log(`  [exists] ${variant} — skip (use --force to regenerate)`);
        continue;
      }

      console.log(`  [generating] ${variant} (${VARIANTS[variant]?.label || 'custom'})...`);
      try {
        const modified = await transformLyrics(
          originalLrc, variant, song.title, song.artist
        );
        fs.writeFileSync(outPath, modified, 'utf8');
        console.log(`  [done] → ${path.relative(process.cwd(), outPath)}`);
      } catch (err) {
        console.error(`  [error] ${variant}: ${err.message}`);
      }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
