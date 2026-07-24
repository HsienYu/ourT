# Unit Tests

Pure-logic unit tests using Node's built-in `node:test` runner (no extra
dependency). These cover only logic extracted from hardware/live-API-coupled
code — the realtime WebSocket bridging itself is verified manually (see
`tests/manual/`).

This is the `lite` branch: KTV/karaoke, stage-script generation, concise
reply mode, and voice-triggered tool calling (response length, song
search/import) were removed. Only the AI Realtime conversation (OpenAI or
Gemini Live) remains.

## How to run

From the repository root:

```bash
node --test tests/unit/*.test.js
```

Or from `server/`:

```bash
npm test
```

## Structure

- `realtime-session.test.js` — covers `server/lib/realtime-session.js`: the
  per-provider reconnect decision (`needsReconnect`) and the OpenAI/Gemini
  session payload builders. Deliberately NOT symmetric — OpenAI only
  reconnects on a voice change, Gemini reconnects on ANY parameter change
  (its public Live API has no live-update mechanism at all; see the
  correction note at the top of `realtime-session.js`) — and asserts the
  zh-TW (臺灣繁體中文) default instructions are always present on both. Also
  covers: short-term rolling memory (`appendTranscriptTurn`,
  `buildGeminiSeedTurns`, `buildOpenAISeedItems` — bounded history seeded into
  a fresh connection so a reconnect doesn't start the conversation cold); and
  regression guards confirming that KTV mutual-exclusion helpers and all
  tool/function-calling builders (removed in lite) are not exported.
- `settings-presets.test.js` — covers the character-preset CRUD logic in
  `server/lib/settings.js` (`getPresets`/`savePreset`/`deletePreset`), using an
  isolated temp settings file per test via `OURT_SETTINGS_PATH` so it never
  touches the real `server/settings.json`. Also covers stripping stale
  `ktv`/`aiFeatures`/`yolo` fields left over from a pre-lite settings file, and
  confirms the lite defaults expose only the realtime-voice provider keys
  (OpenAI, Gemini).
- `provider-catalog.test.js` — covers `server/lib/provider-catalog.js`: the
  static voice catalogs (accuracy checks against each provider's documented
  enum) and the live model-fetch/cache/fallback logic for OpenAI Realtime and
  Gemini, using an injectable `fetch` mock so no real network calls are made.
  Also confirms no text-model fetcher is exported (lite has no
  text-generation providers).
- `build-expiry.test.js` — covers the local-time expiry boundary for packaged
  Electron builds and the bounded recheck interval used to close an App that
  remains open until expiry.
- `reconnect-retry.test.js` — covers bounded retries for an unexpected current
  Gemini disconnect, while excluding stale, manually stopped, and exhausted
  sessions.
- `lite-bugs.test.js` — regression tests for three connection-reliability
  fixes made when trimming down to lite:
  - **14.3** — a Gemini provider error must also broadcast `ai.done`, or
    Projection/Monitor get stuck showing "thinking"/"speaking" forever.
  - **14.5** — the bus must never forward `session.update` to a realtime
    WebSocket that isn't `OPEN` (guards against sending to a `CLOSING` socket).
  - **14.6** — a manual `開始/連線` click must reset the reconnect-attempt
    counter to zero, or a session that already exhausted its automatic retry
    budget can never successfully reconnect again until the app restarts.

## What's intentionally NOT covered here

Anything that requires a live WebSocket, a real provider API key, an actual
Electron window, or physical audio hardware is out of scope for unit tests —
see `tests/manual/app1-realtime.md` for realtime/interrupt/audio verification.

## Coverage expectations

New pure logic added to `server/lib/` (payload builders, decision functions,
settings CRUD) should get unit tests here. Anything that touches a live
socket, external API, or hardware should get a manual protocol entry instead.
