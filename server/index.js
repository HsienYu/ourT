/**
 * server/index.js  — ourT Theatre Performance Server
 *
 * Serves four browser clients over local WiFi:
 *   /control    — operator control panel (mobile)
 *   /projection — shared projection screen (AI text + KTV)
 *   /monitor    — performer stage monitor
 *   /audience   — audience song request page (phone)
 *
 * WebSocket paths:
 *   /ws/realtime  — AI Realtime proxy (OpenAI or Gemini Live)
 *   /ws/bus       — broadcast bus (projection + control + monitor + audience)
 *
 * REST endpoints:
 *   GET  /api/weather           — current Chiayi weather
 *   GET  /api/songs             — song catalog
 *   GET  /api/queue             — current KTV queue
 *   POST /api/queue/enqueue     — { songId, requesterLabel }
 *   POST /api/queue/play        — dequeue and tell projection to play
 *   POST /api/queue/end         — current song ended
 *   POST /api/queue/clear       — clear the queue
 *   GET  /api/songs/:id/lyrics?variant=...  — serve .lrc file
 *   GET  /api/songs/:id/lyrics/variants     — list available variants
 *   POST /api/songs/:id/lyrics/override     — live override lyrics
 *   DELETE /api/songs/:id/lyrics/override   — clear override
 *   POST /api/songs/:id/lyrics/generate     — LLM rewrite
 *   GET  /api/songs/:id/audio               — audio file
 *   GET  /api/songs/:id/cover               — cover art
 *   PATCH /api/songs/:id/offset             — { lrcOffset } live rehearsal sync tuning
 *   GET  /api/songs/search?q=...            — YouTube search (yt-dlp, no API key)
 *   POST /api/songs/import                  — { videoId, title, artist, tags } start async import
 *   GET  /api/songs/import/:jobId           — poll import job status
 *   POST /api/ktv/analyze       — AI song analysis
 *   POST /api/ktv/analyze-trigger — audience triggers analysis
 *   GET  /api/settings          — get all settings (keys masked)
 *   POST /api/settings          — update settings
 *   GET  /api/settings/providers — available providers with key status
 *   GET  /api/settings/models?provider=... — models for provider
 *   GET  /api/settings/gemini-voices — Gemini Live voices
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const { handleRealtimeClient } = require('./lib/realtime-proxy');
const { getWeather, formatForPrompt } = require('./lib/weather');
const songQueue = require('./lib/song-queue');
const settingsLib = require('./lib/settings');
const aiProviders = require('./lib/ai-providers');
const providerCatalog = require('./lib/provider-catalog');
const youtubeSearch = require('./lib/youtube-search');
const songImporter = require('./lib/song-importer');
const { getSongsDir } = require('./lib/song-storage');

const PORT = process.env.PORT || 3000;
const SONGS_DIR = getSongsDir();
const LYRICS_DIR = path.join(SONGS_DIR, 'lyrics');
const AUDIO_DIR = path.join(SONGS_DIR, 'audio');
const COVERS_DIR = path.join(SONGS_DIR, 'covers');

// ── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/control', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/control/index.html')));
app.get('/projection', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/projection/index.html')));
app.get('/monitor', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/monitor/index.html')));
app.get('/audience', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/audience/index.html')));

// ── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/weather', async (req, res) => {
  const w = await getWeather();
  res.json({ ...w, prompt: formatForPrompt(w) });
});

app.get('/api/songs', (req, res) => {
  res.json(songQueue.getCatalog());
});

app.get('/api/queue', (req, res) => {
  res.json(songQueue.getQueue());
});

app.post('/api/queue/enqueue', (req, res) => {
  const { songId, requesterLabel } = req.body;
  const result = songQueue.enqueue(songId, requesterLabel);
  res.json(result);

  // Auto-rewrite lyrics in background when song is queued
  const settings = settingsLib.getSettings();
  if (result.ok && settings.ktv.autoRewrite) {
    if (Object.values(settings.keys).some(Boolean)) {
      const variant = settings.ktv.defaultVariant || 'gender-swap';
      generateLyricsLLM(songId, variant, null).catch((err) => {
        console.error(`[lyrics] Auto-rewrite failed for ${songId}: ${err.message}`);
      });
    }
  }
});

app.post('/api/queue/play', (req, res) => {
  if (songQueue.getQueue().nowPlaying) {
    return res.status(409).json({ ok: false, error: '已有歌曲正在播放，請使用切歌或等待歌曲結束' });
  }
  const item = songQueue.dequeue();
  if (!item) return res.status(400).json({ ok: false, error: '佇列為空' });
  // projectionConnected is informational — the client shows a warning if false,
  // but play proceeds either way because the reconnect handler replays ktv.play
  // when projection later connects (see bus connection handler below).
  const projectionConnected = hasBusClient('projection');
  return res.json({ ok: true, item, projectionConnected });
});

app.post('/api/queue/end', (req, res) => {
  const item = songQueue.endSong();
  res.json({ ok: true, item });
});

app.post('/api/queue/skip', (req, res) => {
  const result = songQueue.skip();
  res.json({ ok: !!result, ...result });
});

app.post('/api/queue/clear', (req, res) => {
  songQueue.clearQueue();
  res.json({ ok: true });
});

// ── Lyrics variant system ─────────────────────────────────────────────────────
const lyricsOverrides = new Map(); // songId → { variant, lrcText }

// GET /api/songs/:id/lyrics?variant=original|gender-swap|emotional|distorted|live
app.get('/api/songs/:id/lyrics', (req, res) => {
  const songId = req.params.id;
  const variant = req.query.variant || 'original';

  const override = lyricsOverrides.get(songId);
  if (variant === 'live' && override) {
    res.type('text/plain').send(override.lrcText);
    return;
  }

  const lrcFile = variant === 'original'
    ? `${songId}.lrc`
    : `${songId}.${variant}.lrc`;
  const lrcPath = path.join(LYRICS_DIR, lrcFile);

  res.sendFile(lrcPath, (err) => {
    if (err) {
      const fallback = path.join(LYRICS_DIR, `${songId}.lrc`);
      res.sendFile(fallback, (err2) => {
        if (err2) res.status(404).json({ error: 'lyrics not found' });
      });
    }
  });
});

app.get('/api/songs/:id/lyrics/variants', (req, res) => {
  const songId = req.params.id;
  const lyricsDir = LYRICS_DIR;
  const KNOWN_VARIANTS = ['original', 'gender-swap', 'emotional', 'distorted'];
  const available = [];

  for (const v of KNOWN_VARIANTS) {
    const file = v === 'original' ? `${songId}.lrc` : `${songId}.${v}.lrc`;
    if (require('fs').existsSync(path.join(lyricsDir, file))) {
      available.push(v);
    }
  }

  const override = lyricsOverrides.get(songId);
  if (override) available.push('live');

  res.json({ songId, variants: available });
});

// POST /api/songs/:id/lyrics/override — live override (operator edits mid-show)
app.post('/api/songs/:id/lyrics/override', (req, res) => {
  const { lrcText, variant } = req.body;
  if (!lrcText) return res.status(400).json({ error: 'lrcText required' });
  lyricsOverrides.set(req.params.id, { lrcText, variant: variant || 'live' });
  broadcast.toProjection({
    type: 'ktv.lyrics.override',
    songId: req.params.id,
    lrcText,
    variant: variant || 'live',
  });
  res.json({ ok: true });
});

app.delete('/api/songs/:id/lyrics/override', (req, res) => {
  lyricsOverrides.delete(req.params.id);
  broadcast.toProjection({ type: 'ktv.lyrics.override.cleared', songId: req.params.id });
  res.json({ ok: true });
});

// ── RAG context loader ────────────────────────────────────────────────────────
function loadRagContext() {
  const ragPath = path.join(__dirname, 'rag');
  try {
    const files = fs.readdirSync(ragPath).filter((f) => /\.(md|txt)$/.test(f));
    const chunks = files.map((f) => fs.readFileSync(path.join(ragPath, f), 'utf8'));
    const combined = chunks.join('\n\n');
    return combined.length > 4000 ? combined.slice(0, 4000) + '\n[…截斷]' : combined;
  } catch {
    return '';
  }
}

// ── Shared LLM lyrics generation (uses ai-providers abstraction) ──────────────
const VARIANT_PROMPTS = {
  'gender-swap': `你是一位繁體中文歌詞改編者。根據演出概念背景，將歌詞中的性別詞語進行流動性互換（他↔她↔TA、男↔女、哥↔姐等）。保持 LRC 時間戳記格式和音節數不變（±2字）。只輸出 LRC 內容，不要任何說明。`,
  'emotional':   `你是一位繁體中文詩人。根據演出概念背景，將歌詞情緒放大強化，使用更具身體感、脆弱感或衝擊力的語言。保持音節數（±2字）。保持 LRC 時間戳記格式不變。只輸出 LRC 內容，不要任何說明。`,
  'distorted':   `你是一位超現實主義繁體中文詩人。根據演出概念背景，將歌詞進行詩意扭曲與異化，打破語義邏輯，引入陌生意象，解構性別與身份預設。保持 LRC 時間戳記格式不變。只輸出 LRC 內容，不要任何說明。`,
};

async function generateLyricsLLM(songId, variant, customPrompt) {
  const catalog = songQueue.getCatalog();
  const song = catalog.find((s) => s.id === songId);
  if (!song) throw new Error('song not found');

  let originalLrc;
  try {
    originalLrc = fs.readFileSync(path.join(LYRICS_DIR, `${songId}.lrc`), 'utf8');
  } catch {
    throw new Error('original lyrics not found');
  }

  const ragContext = loadRagContext();
  const systemPrompt = ragContext
    ? `【演出概念背景】\n${ragContext}\n\n${VARIANT_PROMPTS[variant] || customPrompt || '請依照演出概念背景改寫以下歌詞。保持 LRC 時間戳記格式不變。只輸出 LRC 內容。'}`
    : (VARIANT_PROMPTS[variant] || customPrompt || '請依照演出概念背景改寫以下歌詞。保持 LRC 時間戳記格式不變。只輸出 LRC 內容。');

  const { text } = await aiProviders.generateText({
    task: 'lyricsRewrite',
    system: systemPrompt,
    prompt: `歌曲：《${song.title}》 ${song.artist}\n\n${originalLrc}`,
    options: { maxTokens: 2048 },
  });

  // Save to file and set as live override
  const outPath = path.join(LYRICS_DIR, `${songId}.${variant}.lrc`);
  fs.writeFileSync(outPath, text, 'utf8');
  lyricsOverrides.set(songId, { lrcText: text, variant });

  broadcast.toProjection({
    type: 'ktv.lyrics.override',
    songId,
    lrcText: text,
    variant,
  });

  console.log(`[lyrics] Generated variant '${variant}' for song '${songId}'`);
  return { text, variant };
}

// POST /api/songs/:id/lyrics/generate — trigger live LLM rewrite
app.post('/api/songs/:id/lyrics/generate', async (req, res) => {
  const variant = req.body.variant || 'gender-swap';
  const customPrompt = req.body.customPrompt;
  try {
    const { text } = await generateLyricsLLM(req.params.id, variant, customPrompt);
    res.json({ ok: true, variant, lrcText: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// KTV AI analysis (uses ai-providers abstraction)
app.post('/api/ktv/analyze', async (req, res) => {
  const { item } = req.body;
  if (!item || !item.song) return res.status(400).json({ error: 'missing item' });

  const { title, artist } = item.song;
  const prompt =
    `一位觀眾在劇場表演現場點了《${title}》（${artist}）。\n` +
    `請根據這首歌的情感色彩、歌詞主題（若你知道的話）、以及這首歌在台灣流行文化中的意涵，` +
    `分析這位觀眾可能的心理狀態、情感傾向、或性別文化認同線索。\n` +
    `回答用繁體中文，100 字以內，語氣像在旁白，不要條列式。`;

  try {
    const { text } = await aiProviders.generateText({
      task: 'songAnalysis',
      system: prompt,
      prompt: `歌曲：《${title}》 ${artist}`,
      options: { maxTokens: 300 },
    });
    res.json({ analysis: text });
  } catch (err) {
    console.error('[ktv/analyze] AI error:', err.message);
    res.json({ analysis: '（分析失敗：' + err.message + '）' });
  }
});

// Audience phone triggers analysis on projection via bus
app.post('/api/ktv/analyze-trigger', (req, res) => {
  const { item } = req.body;
  if (!item) return res.status(400).json({ error: 'missing item' });
  broadcast.toProjection({ type: 'ktv.analyze', item });
  res.json({ ok: true });
});

// Serve cover art
app.get('/api/songs/:id/cover', (req, res) => {
  const ext = req.query.ext || 'jpg';
  const coverPath = path.join(COVERS_DIR, `${req.params.id}.${ext}`);
  res.sendFile(coverPath, (err) => {
    if (err) res.status(404).json({ error: 'cover not found' });
  });
});

// Serve audio files
app.get('/api/songs/:id/audio', (req, res) => {
  const ext = req.query.ext || 'mp3';
  const audioPath = path.join(AUDIO_DIR, `${req.params.id}.${ext}`);
  res.sendFile(audioPath, (err) => {
    if (err) res.status(404).json({ error: 'audio not found' });
  });
});

// Live rehearsal lyric-offset tuning — shifts the whole song's LRC timing
// without re-importing. Used by the "歌詞偏移" slider in /control. Broadcasts
// so the projection screen applies the new offset immediately if that song
// is currently playing.
app.patch('/api/songs/:id/offset', (req, res) => {
  const { lrcOffset } = req.body;
  if (typeof lrcOffset !== 'number' || !Number.isFinite(lrcOffset)) {
    return res.status(400).json({ error: 'lrcOffset must be a finite number (seconds)' });
  }
  const song = songQueue.updateSongOffset(req.params.id, lrcOffset);
  if (!song) return res.status(404).json({ error: 'song not found' });
  broadcast.toProjection({ type: 'ktv.offset.update', songId: req.params.id, lrcOffset });
  res.json({ ok: true, song });
});

// ── YouTube search + import (no API key — uses yt-dlp's ytsearch) ─────────────
app.get('/api/songs/search', async (req, res) => {
  const q = req.query.q;
  if (!q || !q.trim()) return res.status(400).json({ error: 'q query param required' });
  try {
    const results = await youtubeSearch.searchYoutube(q, 6);
    res.json(results);
  } catch (err) {
    console.error('[songs/search] yt-dlp search failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// In-memory import job tracking. Download + transcription can take 30-90s,
// so import runs in the background and the client polls for status.
const importJobs = new Map(); // jobId -> { status: 'running'|'done'|'error', message, songId? }

app.post('/api/songs/import', (req, res) => {
  const { videoId, title, artist, tags } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  const jobId = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  importJobs.set(jobId, { status: 'running', message: '準備中…' });
  res.json({ jobId });

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  songImporter.importSong({
    url,
    title,
    artist,
    tags: Array.isArray(tags) ? tags : [],
    onProgress: (message) => importJobs.set(jobId, { status: 'running', message }),
  }).then((result) => {
    importJobs.set(jobId, { status: 'done', message: '完成', songId: result.id });
  }).catch((err) => {
    console.error('[songs/import] failed:', err.message);
    importJobs.set(jobId, { status: 'error', message: err.message });
  });
});

app.get('/api/songs/import/:jobId', (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

// ── Settings REST API ────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json(settingsLib.getSettings(true)); // mask keys
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = settingsLib.updateSettings(req.body);
    res.json({ settings: settingsLib.getSettings(true), updated: !!updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/settings/providers', (req, res) => {
  res.json(settingsLib.getProviderOptions());
});

// Model lists: OpenAI and Gemini are fetched live from each provider's own
// models.list endpoint (cached briefly, with a static fallback on failure —
// see lib/provider-catalog.js). Other text-generation providers stay static.
app.get('/api/settings/models', async (req, res) => {
  const provider = req.query.provider;
  if (!provider) return res.status(400).json({ error: 'provider query required' });
  const settings = settingsLib.getSettings(false);
  try {
    if (provider === 'openai') {
      return res.json(await providerCatalog.fetchOpenAIRealtimeModels(settings.keys.openai));
    }
    if (provider === 'gemini') {
      return res.json(await providerCatalog.fetchGeminiModels(settings.keys.gemini, 'text'));
    }
    if (provider === 'geminiLive') {
      return res.json(await providerCatalog.fetchGeminiModels(settings.keys.gemini, 'live'));
    }
    res.json(settingsLib.getModelsForProvider(provider));
  } catch (err) {
    console.error('[settings/models] fetch failed:', err.message);
    res.json(settingsLib.getModelsForProvider(provider));
  }
});

// Voice catalogs: neither provider exposes a live "list voices" API — these
// are the full, current, accurate static catalogs from provider-catalog.js.
app.get('/api/settings/openai-voices', (req, res) => {
  res.json(providerCatalog.OPENAI_REALTIME_VOICES);
});

app.get('/api/settings/gemini-voices', (req, res) => {
  res.json(providerCatalog.GEMINI_LIVE_VOICES);
});

// ── Character presets ─────────────────────────────────────────────────────
app.get('/api/presets', (req, res) => {
  res.json(settingsLib.getPresets());
});

app.post('/api/presets', (req, res) => {
  try {
    const presets = settingsLib.savePreset(req.body);
    res.json({ ok: true, presets });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/presets/:id', (req, res) => {
  const presets = settingsLib.deletePreset(req.params.id);
  res.json({ ok: true, presets });
});

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket servers ─────────────────────────────────────────────────────────
const wssBus = new WebSocket.Server({ noServer: true });
const wssRealtime = new WebSocket.Server({ noServer: true });

const busClients = new Map(); // ws → { role: 'projection'|'control'|'audience'|'monitor' }
let activeRealtimeWs = null;

function hasBusClient(role) {
  for (const [ws, meta] of busClients) {
    if (meta.role === role && ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

// Broadcast bus implementation
const broadcast = {
  toAll(event) {
    const msg = JSON.stringify(event);
    for (const [ws] of busClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  },
  toProjection(event) {
    const msg = JSON.stringify(event);
    for (const [ws, meta] of busClients) {
      if (meta.role === 'projection' && ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  },
  toControl(event) {
    const msg = JSON.stringify(event);
    for (const [ws, meta] of busClients) {
      if (meta.role === 'control' && ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  },
  toMonitor(event) {
    const msg = JSON.stringify(event);
    for (const [ws, meta] of busClients) {
      if (meta.role === 'monitor' && ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  },
  toMain(event) {
    const msg = JSON.stringify(event);
    for (const [ws, meta] of busClients) {
      if (meta.role === 'main' && ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  },
};

// Inject broadcast bus into song queue
songQueue.init(broadcast);

// ── Bus WebSocket handler ─────────────────────────────────────────────────────
wssBus.on('connection', (ws, req) => {
  const role = new URL(req.url, 'http://localhost').searchParams.get('role') || 'unknown';
  busClients.set(ws, { role });
  console.log(`[bus] Client connected: role=${role}, total=${busClients.size}`);

  ws.send(JSON.stringify({ type: 'bus.welcome', role }));
  getWeather().then((w) => {
    ws.send(JSON.stringify({ type: 'weather.update', weather: w, prompt: formatForPrompt(w) }));
  });
  ws.send(JSON.stringify({ type: 'queue.updated', queue: songQueue.getQueue() }));
  // When projection (re)connects: replay the current song if one is playing.
  if (role === 'projection' && songQueue.getQueue().nowPlaying) {
    ws.send(JSON.stringify({ type: 'ktv.play', item: songQueue.getQueue().nowPlaying }));
  }
  // Notify all operator panels when projection comes online.
  if (role === 'projection') {
    broadcast.toControl({ type: 'projection.status', connected: true });
  }
  // Tell a newly connected control panel the current projection status.
  if (role === 'control') {
    ws.send(JSON.stringify({ type: 'projection.status', connected: hasBusClient('projection') }));
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Control panel pushes session updates through the bus
    if (msg.type === 'session.update' && activeRealtimeWs) {
      activeRealtimeWs.send(JSON.stringify({ type: 'session.update', session: msg.session }));
    }

    // Operator switches projection mode (ai / ktv)
    if (msg.type === 'projection.mode') {
      broadcast.toProjection({ type: 'projection.mode', mode: msg.mode });
    }

    if (msg.type === 'projection.fullscreen') {
      broadcast.toMain({ type: 'projection.fullscreen' });
    }

    // Operator triggers KTV AI analysis
    if (msg.type === 'ktv.analyze') {
      broadcast.toProjection({ type: 'ktv.analyze', item: msg.item });
    }

    // Operator clears AI transcript display
    if (msg.type === 'transcript.clear') {
      broadcast.toProjection({ type: 'transcript.clear' });
      broadcast.toMonitor({ type: 'transcript.clear' });
    }

    // Control panel pushes current AI params so the monitor page can display them
    if (msg.type === 'monitor.params') {
      broadcast.toMonitor({ type: 'monitor.params', params: msg.params });
    }

    // KTV lyric style toggle (wipe / line) — projection listens
    if (msg.type === 'projection.lyric_style') {
      broadcast.toProjection({ type: 'projection.lyric_style', style: msg.style });
    }

    // KTV lyric variant change (operator selects different LLM variant)
    if (msg.type === 'projection.lyric_variant') {
      broadcast.toProjection({ type: 'projection.lyric_variant', variant: msg.variant });
    }

    // Operator changes realtime voice provider
    if (msg.type === 'realtime.provider') {
      broadcast.toAll({ type: 'realtime.provider', provider: msg.provider });
    }
  });

  ws.on('close', () => {
    busClients.delete(ws);
    console.log(`[bus] Client disconnected: role=${role}, total=${busClients.size}`);
    // Notify operator panels when the last projection client drops.
    if (role === 'projection') {
      broadcast.toControl({ type: 'projection.status', connected: hasBusClient('projection') });
    }
  });
});

// ── Realtime WebSocket handler ────────────────────────────────────────────────
wssRealtime.on('connection', (ws) => {
  console.log('[realtime] Actor browser connected');
  activeRealtimeWs = ws;

  // Load current settings for API keys and provider defaults
  const settings = settingsLib.getSettings(false);
  const apiKeys = {
    openai: settings.keys.openai,
    gemini: settings.keys.gemini,
    openaiRealtime: settings.models.openaiRealtime,
    geminiLive: settings.models.geminiLive,
  };

  // Use the new realtime proxy which handles both OpenAI and Gemini
  const { handleRealtimeClient } = require('./lib/realtime-proxy');
  handleRealtimeClient(ws, broadcast, {
    openai:        apiKeys.openai,
    gemini:        apiKeys.gemini,
    openaiRealtime: apiKeys.openaiRealtime,
    geminiLive:    apiKeys.geminiLive,
  });

  ws.on('close', () => {
    if (activeRealtimeWs === ws) activeRealtimeWs = null;
  });
});

// ── WebSocket upgrade routing ─────────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (pathname === '/ws/realtime') {
    wssRealtime.handleUpgrade(req, socket, head, (ws) => {
      wssRealtime.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/bus') {
    wssBus.handleUpgrade(req, socket, head, (ws) => {
      wssBus.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// ── Periodic weather push to all clients ─────────────────────────────────────
setInterval(async () => {
  const w = await getWeather();
  broadcast.toAll({ type: 'weather.update', weather: w, prompt: formatForPrompt(w) });
}, 5 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  console.log('\n  ourT Theatre Performance Server');
  console.log('  ─────────────────────────────────');
  console.log(`  Operator panel:  http://${localIP}:${PORT}/control`);
  console.log(`  Projection:      http://${localIP}:${PORT}/projection`);
  console.log(`  Monitor:         http://${localIP}:${PORT}/monitor`);
  console.log(`  Audience:        http://${localIP}:${PORT}/audience`);
  console.log(`  Local access:    http://localhost:${PORT}/control`);
  // Electron detects this line to know the server is ready:
  console.log('READY:' + PORT);
  console.log('');
});
