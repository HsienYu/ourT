/**
 * server/index.js  — ourT Theatre Performance Server (lite)
 *
 * Serves three browser clients over local WiFi:
 *   /control    — operator control panel
 *   /projection — AI transcript projection screen
 *   /monitor    — performer stage monitor
 *
 * WebSocket paths:
 *   /ws/realtime  — AI Realtime proxy (OpenAI or Gemini Live)
 *   /ws/bus       — broadcast bus (projection + control + monitor)
 *
 * REST endpoints:
 *   GET  /api/weather               — current Chiayi weather
 *   GET  /api/rag/context           — RAG context for AI instructions
 *   GET  /api/settings              — get all settings (keys masked)
 *   POST /api/settings              — update settings
 *   GET  /api/settings/providers    — available providers with key status
 *   GET  /api/settings/models?provider=... — account-visible model list
 *   GET  /api/settings/openai-voices — OpenAI Realtime voice catalog
 *   GET  /api/settings/gemini-voices — Gemini Live voice catalog
 *   GET  /api/presets               — character presets
 *   POST /api/presets               — save / overwrite preset
 *   DELETE /api/presets/:id         — delete preset
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const { handleRealtimeClient } = require('./lib/realtime-proxy');
const { getWeather, formatForPrompt } = require('./lib/weather');
const settingsLib = require('./lib/settings');
const providerCatalog = require('./lib/provider-catalog');

const PORT = process.env.PORT || 3000;

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/control', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/control/index.html')));
app.get('/projection', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/projection/index.html')));
app.get('/monitor', (req, res) =>
  res.sendFile(path.join(__dirname, 'public/monitor/index.html')));

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/weather', async (req, res) => {
  const w = await getWeather();
  res.json({ ...w, prompt: formatForPrompt(w) });
});

// RAG context for the AI Realtime conversation (server/rag/*.md)
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

app.get('/api/rag/context', (req, res) => {
  res.type('text/plain').send(loadRagContext());
});

// ── Settings REST API ─────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json(settingsLib.getSettings(true));
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = settingsLib.updateSettings(req.body);
    providerCatalog.clearCache();
    res.json({ settings: settingsLib.getSettings(true), updated: !!updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/settings/providers', (req, res) => {
  res.json(settingsLib.getProviderOptions());
});

// Account-visible model lists (OpenAI Realtime and Gemini only in lite)
app.get('/api/settings/models', async (req, res) => {
  const provider = req.query.provider;
  if (!provider) return res.status(400).json({ error: 'provider query required' });
  const settings = settingsLib.getSettings(false);
  try {
    if (provider === 'openai') {
      return res.json({ models: await providerCatalog.fetchOpenAIRealtimeModels(settings.keys.openai), source: 'live' });
    }
    if (provider === 'gemini') {
      return res.json({ models: await providerCatalog.fetchGeminiModels(settings.keys.gemini, 'text'), source: 'live' });
    }
    if (provider === 'geminiLive') {
      return res.json({ models: await providerCatalog.fetchGeminiModels(settings.keys.gemini, 'live'), source: 'live' });
    }
    return res.status(400).json({ error: `unknown provider: ${provider}` });
  } catch (err) {
    console.error('[settings/models] fetch failed:', err.message);
    res.json({ models: [], source: 'fallback', warning: '無法取得即時模型清單' });
  }
});

app.get('/api/settings/openai-voices', (req, res) => {
  res.json(providerCatalog.OPENAI_REALTIME_VOICES);
});

app.get('/api/settings/gemini-voices', (req, res) => {
  res.json(providerCatalog.GEMINI_LIVE_VOICES);
});

// ── Character presets ─────────────────────────────────────────────────────────
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

const busClients = new Map(); // ws → { role }
let activeRealtimeWs = null;

function hasBusClient(role) {
  for (const [ws, meta] of busClients) {
    if (meta.role === role && ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

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

// ── Bus WebSocket handler ─────────────────────────────────────────────────────
wssBus.on('connection', (ws, req) => {
  const role = new URL(req.url, 'http://localhost').searchParams.get('role') || 'unknown';
  busClients.set(ws, { role });
  console.log(`[bus] Client connected: role=${role}, total=${busClients.size}`);

  ws.send(JSON.stringify({ type: 'bus.welcome', role }));
  getWeather().then((w) => {
    ws.send(JSON.stringify({ type: 'weather.update', weather: w, prompt: formatForPrompt(w) }));
  });

  if (role === 'projection') {
    broadcast.toControl({ type: 'projection.status', connected: true });
  }
  if (role === 'control') {
    ws.send(JSON.stringify({ type: 'projection.status', connected: hasBusClient('projection') }));
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Control panel pushes session updates through the bus — 14.5 fix: readyState guard
    if (msg.type === 'session.update' && activeRealtimeWs && activeRealtimeWs.readyState === WebSocket.OPEN) {
      activeRealtimeWs.send(JSON.stringify({ type: 'session.update', session: msg.session }));
    }

    if (msg.type === 'projection.fullscreen') {
      broadcast.toMain({ type: 'projection.fullscreen' });
    }

    if (msg.type === 'transcript.clear') {
      broadcast.toProjection({ type: 'transcript.clear' });
      broadcast.toMonitor({ type: 'transcript.clear' });
    }

    if (msg.type === 'monitor.params') {
      broadcast.toMonitor({ type: 'monitor.params', params: msg.params });
    }

    if (msg.type === 'realtime.provider') {
      broadcast.toAll({ type: 'realtime.provider', provider: msg.provider });
    }
  });

  ws.on('close', () => {
    busClients.delete(ws);
    console.log(`[bus] Client disconnected: role=${role}, total=${busClients.size}`);
    if (role === 'projection') {
      broadcast.toControl({ type: 'projection.status', connected: hasBusClient('projection') });
    }
  });
});

// ── Realtime WebSocket handler ────────────────────────────────────────────────
wssRealtime.on('connection', (ws) => {
  console.log('[realtime] Actor browser connected');
  activeRealtimeWs = ws;

  const settings = settingsLib.getSettings(false);
  handleRealtimeClient(ws, broadcast, {
    openai:         settings.keys.openai,
    gemini:         settings.keys.gemini,
    openaiRealtime: settings.models.openaiRealtime,
    geminiLive:     settings.models.geminiLive,
  });

  ws.on('close', () => {
    if (activeRealtimeWs === ws) activeRealtimeWs = null;
  });
});

// ── WebSocket upgrade routing ─────────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/ws/realtime') {
    wssRealtime.handleUpgrade(req, socket, head, (ws) => wssRealtime.emit('connection', ws, req));
  } else if (pathname === '/ws/bus') {
    wssBus.handleUpgrade(req, socket, head, (ws) => wssBus.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// ── Periodic weather push ─────────────────────────────────────────────────────
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
      if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
    }
  }
  console.log('\n  ourT — lite');
  console.log('  ─────────────────────────────────');
  console.log(`  Operator panel:  http://${localIP}:${PORT}/control`);
  console.log(`  Projection:      http://${localIP}:${PORT}/projection`);
  console.log(`  Monitor:         http://${localIP}:${PORT}/monitor`);
  console.log(`  Local access:    http://localhost:${PORT}/control`);
  console.log('READY:' + PORT);
  console.log('');
});
