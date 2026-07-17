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
- `lyrics-sync.test.js` — covers `server/lib/lyrics-sync.js`: LRC timestamp
  formatting/parsing (including the centisecond rounding carry-over fix, e.g.
  59.999s must round to `[01:00.00]`, not a malformed `[00:59.100]`),
  word-level segment timestamp refinement (`refineSegmentTimestamps` — the
  core of the karaoke sync accuracy improvement), and the live "歌詞偏移"
  offset shift.
- `youtube-search.test.js` — covers `server/lib/youtube-search.js`: parsing
  yt-dlp's `--dump-json` search output, thumbnail selection, and
  query-building/error-handling, using an injectable `execFile` mock so no
  real `yt-dlp`/network calls are made.
- `song-queue.test.js` — covers the catalog-writing helpers added for the
  search/import feature (`addSongToCatalog`, `updateSongOffset`) and KTV queue
  lifecycle (`endSong`, `skip`), using an isolated temp catalog file per test
  via `OURT_SONGS_CATALOG_PATH` so it never touches the real `songs/index.json`.
- `build-expiry.test.js` — covers the local-time expiry boundary for packaged
  Electron builds and the bounded recheck interval used to close an App that
  remains open until expiry.
- `song-storage.test.js` — covers first-launch seeding of packaged songs into
  the writable runtime songs directory and preservation of imported media on
  later launches.

## What's intentionally NOT covered here

Anything that requires a live WebSocket, a real provider API key, an actual
Electron window, physical audio hardware, or a real `yt-dlp`/Whisper call is
out of scope for unit tests — see `tests/manual/app1-realtime.md` for
realtime/interrupt/audio verification and `tests/manual/app3-ktv.md` for KTV
song search, import, and lyric-offset verification against real YouTube URLs
and audio playback.

## Coverage expectations

New pure logic added to `server/lib/` (payload builders, decision functions,
settings CRUD) should get unit tests here. Anything that touches a live
socket, external API, or hardware should get a manual protocol entry instead.
