# Unit Tests

Pure-logic unit tests using Node's built-in `node:test` runner (no extra
dependency). These cover only logic extracted from hardware/live-API-coupled
code — the realtime WebSocket bridging itself is verified manually (see
`tests/manual/`).

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
  zh-TW (臺灣繁體中文) default instructions are always present on both.
- `settings-presets.test.js` — covers the character-preset CRUD logic in
  `server/lib/settings.js` (`getPresets`/`savePreset`/`deletePreset`), using an
  isolated temp settings file per test via `OURT_SETTINGS_PATH` so it never
  touches the real `server/settings.json`.
- `provider-catalog.test.js` — covers `server/lib/provider-catalog.js`: the
  static voice catalogs (accuracy checks against each provider's documented
  enum) and the live model-fetch/cache/fallback logic, using an injectable
  `fetch` mock so no real network calls are made.

## What's intentionally NOT covered here

Anything that requires a live WebSocket, a real provider API key, an actual
Electron window, or physical audio hardware is out of scope for unit tests —
see `tests/manual/app1-realtime.md` for the manual verification protocol
covering interrupt/barge-in behavior, live parameter updates against real
providers, fullscreen/kiosk toggling, and audio output.

## Coverage expectations

New pure logic added to `server/lib/` (payload builders, decision functions,
settings CRUD) should get unit tests here. Anything that touches a live
socket, external API, or hardware should get a manual protocol entry instead.
