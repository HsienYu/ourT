# Plan: ourT Theatre Performance Apps

Workflow: Prototype (Section 6) — performance installation for a specific venue run.
Hardware-coupled elements (camera, audio, projection) use Hybrid Verification (Section 7).
TDD not required. Manual verification protocols required before each rehearsal.

---

## Phase 0 — Scaffold [done]
- [done] Create directory structure (experiments/, server/, app2-yolo/, songs/, tests/manual/)
- [done] Move gender_performance_prototype.html to experiments/
- [done] Create experiments/README.md (spike register)
- [done] Node.js: npm init, install express + ws + dotenv
- [done] Create .gitignore

## Phase 1 — App 1: GPT-4o Realtime Proxy + Control Panel [done]
- [done] server/lib/realtime-proxy.js: WebSocket bridge to OpenAI Realtime (gpt-realtime-2.1)
- [done] server/lib/weather.js: OpenMeteo fetch for Chiayi (23.48N, 120.45E), 5-min cache
- [done] server/lib/song-queue.js: KTV queue management + broadcast bus
- [done] server/index.js: Express + WS server, REST API, WebSocket upgrade routing
- [done] server/public/control/index.html: operator panel (mobile-responsive)
  - Voice selector (alloy/echo/fable/onyx/nova/shimmer)
  - Attitude switch (passive / resistant)
  - Emotional state presets (5 states)
  - Personality sliders (doubt, gender, pressure, label, energy)
  - Custom system prompt override field
  - Session start / update / interrupt / close controls
  - KTV queue view + play/end/clear controls
  - Weather widget
  - Status log
- [done] server/public/control/pcm-processor.js: AudioWorklet PCM16 mic processor
- [done] Canonical settings stored in user-writable settings.json

## Phase 2 — App 1 + App 3: Projection Screen [done]
- [done] server/public/projection/index.html: shared projection screen
  - AI mode: streaming transcript text, ambient status bar (weather, time, mode)
  - KTV mode: song info, LRC-synced lyrics (prev/active/next lines), HTML5 audio
  - Analysis overlay (Claude interpretation, dismissable)
  - WebSocket bus integration (transcript.delta, ktv.play, projection.mode, etc.)
- [done] server/public/audience/index.html: mobile song request page
  - Catalog browse + search
  - Request button → enqueue
  - "他點這首歌有什麼樣的傾向？" trigger
- [done] POST /api/ktv/analyze: Claude API call for song psychological analysis
- [done] POST /api/ktv/analyze-trigger: audience phone triggers analysis on projection
- [done] songs/index.json: catalog schema + placeholder entry

## Phase 3 — KTV Lyrics LLM System [done]
- [done] server/scripts/generate-lyrics.js: pre-generate all variants offline
  - Variants: gender-swap, emotional (情緒放大), distorted (超現實扭曲), custom
  - Usage: node scripts/generate-lyrics.js [--song id] [--variant name] [--force]
- [done] GET /api/songs/:id/lyrics?variant=original|gender-swap|emotional|distorted|live
- [done] GET /api/songs/:id/lyrics/variants — list available variants
- [done] POST /api/songs/:id/lyrics/override — set live LRC override (broadcasts to projection)
- [done] DELETE /api/songs/:id/lyrics/override — clear override (reverts to original)
- [done] POST /api/songs/:id/lyrics/generate — live LLM rewrite via Claude API
- [done] Operator control panel: Lyrics Editor section
  - Song selector, variant buttons, LLM generate, manual LRC editor, push/clear
- [done] Projection: handles ktv.lyrics.override and ktv.lyrics.override.cleared events
- [todo] Add real songs to songs/index.json (title, artist, tags)
- [todo] Add audio files to songs/audio/ (mp3)
- [todo] Add LRC lyrics files to songs/lyrics/ (one per song)
- [todo] Add cover art to songs/covers/ (jpg)
- [todo] Run: node scripts/generate-lyrics.js to pre-generate all variants

## Phase 4 — App 2: YOLO Camera [done]
- [done] app2-yolo/: Python venv setup
- [done] requirements.txt: ultralytics, opencv-python, mediapipe, fastapi, uvicorn
- [done] app2-yolo/processors/yolo_detector.py: YOLOv8 person detection + MediaPipe pose
- [done] app2-yolo/processors/gender_heuristics.py:
  - MediaPipe Pose: shoulder/hip ratio heuristic
  - HSV k-means color sampling: upper vs lower torso dominant color
  - Score → label: 男性化 / 女性化 / 中性 / 不確定性
- [done] app2-yolo/processors/camera_source.py: webcam / NDI / Syphon abstraction
- [done] app2-yolo/config.yaml: all parameters (camera, yolo, heuristics, labels, colors, output)
- [done] app2-yolo/main.py: FastAPI server at port 3001
- [done] /panel: YOLO operator mini-panel
  - Global bias slider (-50 to +50)
  - Oscillation toggle, randomization toggle
  - Custom label text inputs (live update)
  - Live detection list with label+score
- [done] /preview: MJPEG annotated stream
- [done] POST /api/config: runtime config update

## Phase 5 — App 2: NDI/Syphon Output [done]
- [done] app2-yolo/output/ndi_output.py: annotated frames → NDI send
- [done] app2-yolo/output/syphon_output.py: annotated frames → Syphon (macOS)
- [todo] Manual test: NDI stream received in Resolume / VDMX / OBS (needs hardware)
- [done] NDI receive + Syphon input in camera_source.py

## Phase 6 — Performer UI + KTV + LLM Lyrics + Standalone [done]
- [done] VAD events (speech_started/stopped) + ai.thinking forwarded through broadcast bus
- [done] server/public/monitor/index.html: performer stage monitor page
  - MIC live indicator, turn indicator, AI state machine, rolling transcript
  - Current emotional state / params display, KTV now-playing strip
- [done] Projection: VAD dot, cursor state machine (idle/thinking/speaking), border turn signal
- [done] Control panel: realtime session badge, mic live dot, monitor.params push, lyric style toggle
- [done] KTV: character-level colour wipe (operator toggles wipe vs line mode)
- [done] KTV: variant-specific wipe colours (gender-swap=blue, emotional=orange, distorted=purple)
- [done] KTV: song progress bar
- [done] KTV: blurred cover art background (::before pseudo-element)
- [done] LLM lyrics: RAG context loader (server/rag/ directory)
- [done] LLM lyrics: auto-rewrite on enqueue (configured in Control settings)
- [done] ktv.lyrics.override broadcast extended with variant field
- [done] app2-yolo/app.py: embedded FastAPI server in background thread
- [done] app2-yolo/setup.py: py2app bundle configuration
- [done] ourT-electron/: Electron bundle (main.js + package.json)
  - Forks Node.js server, opens 3 windows (projection/monitor/control) automatically
  - System tray: open/reopen windows, copy audience URL, open Control settings, quit
  - API keys and runtime configuration from ~/Library/Application Support/ourT/settings.json
- [done] server/scripts/import-song.js: yt-dlp + Whisper song import CLI
- [done] start.sh: development launcher
- [done] tests/manual/app1-realtime.md
- [done] tests/manual/app2-yolo.md
- [done] tests/manual/app3-ktv.md
- [done] README.md: complete setup, startup, troubleshooting, pre-performance checklist
- [done] Electron app tested: npm install, npm start — server starts, all 3 windows (control/monitor/projection) connect to bus, weather fetched live
  - Settings are passed to the server via `OURT_SETTINGS_PATH`; legacy `.env` is imported once only
  - Fixed: tray-icon.png created (16x16 white PNG); Electron no longer crashes on missing asset
- [todo] Soak test: all apps running simultaneously for 2+ hours (needs hardware)
- [todo] Add real songs to catalog + run generate-lyrics.js
- [todo] Manual NDI test: stream received in Resolume/VDMX/OBS (needs hardware)

## Phase 7 — Multi-Provider Realtime and Settings [active]

The server now has OpenAI Realtime and Gemini Live bridge implementations, masked runtime settings APIs, an operator settings panel, and input/output audio diagnostics. Electron uses `~/Library/Application Support/ourt/settings.json` as the sole runtime configuration source; legacy `server/settings.json` values and `.env` keys are imported once only when that JSON file does not exist. Gemini Live setup and audio response were externally confirmed; complete end-to-end rehearsal verification remains pending.

- [done] Add speaker-aware input/output transcript events and OpenCC Taiwan Traditional display normalization
- [done] Enable Gemini Live input/output transcription and OpenAI Chinese input transcription
- [done] Add distinct 演員/AI transcript turns and Projection transcript auto-scroll
- [done] Relay Control Projection fullscreen requests to Electron
- [todo] Manual verify an OpenAI Realtime session using `tests/manual/app1-realtime.md`
- [todo] Manual verify a Gemini Live session using `tests/manual/app1-realtime.md`
- [todo] Verify selected microphone/output device, 24kHz input conversion, input/output meters, speaker playback, transcript roles, auto-scroll, and fullscreen
- [todo] Record provider, latency, VAD, transcript, and audio-output evidence from rehearsal

## Phase 8 — Interrupt, Live Parameters, Presets, Provider Parity [active]

Fixed a live-rehearsal bug report covering: an Electron crash on fullscreen
toggle (`setFrame` does not exist in Electron on any platform), the control
window's default screen position, AI character parameters/voice/打斷 not
actually reaching the AI, and a request that voice/model selection be as
accurate as possible against each provider's real capabilities.

Root-caused against each provider's own documentation: OpenAI's `session.update`
relay was sending an invalid flat schema (silently rejecting the whole update,
not just voice); voice is locked mid-session on OpenAI (after first audio) and
on Gemini (for the entire session, no in-place update of any kind); 打斷 only
sent a cancel to the provider but never stopped already-buffered local audio
playback. Neither provider exposes a live "list voices" API, so voice
catalogs are corrected static data; both do expose a real `models.list`
endpoint, which is now fetched live with caching and fallback.

**Correction (same-day, live-tested):** the first version of this phase
implemented Gemini Live instruction updates via a `clientContent`
`role:"system"` message, based on a Vertex AI / Gemini Enterprise Agent
Platform doc page describing a different product than the public Gemini
Developer API this app uses (`generativelanguage.googleapis.com`). Live
rehearsal testing showed this actually closes the Gemini WebSocket with code
1007 `Request contains an invalid argument` on every parameter change — the
exact "live parameter changes cause disconnection" symptom reported. This
matches widely-reported behavior from other developers hitting the same
docs/API mismatch (see `googleapis/js-genai#820` and `#1085`). Fixed by
removing the Gemini live-update path entirely: Gemini's public Live API has
no in-place update mechanism of any kind (confirmed by its own capabilities
guide: `send_client_content` "is only supported for seeding initial context
history"), so **any** character parameter change on Gemini now reconnects,
same as a voice change always does on OpenAI. `needsReconnect()` in
`realtime-session.js` and its unit tests were updated to reflect this — the
two providers are deliberately NOT symmetric here.

- [done] `server/lib/realtime-session.js`: pure, unit-tested session payload
  builders and `needsReconnect()` decision — NOT symmetric across providers:
  OpenAI reconnects only on a voice change, Gemini reconnects on ANY
  parameter change (see correction note above and in the module's header)
- [done] Fix OpenAI `session.update` to the correct nested `audio.output.voice`
  schema on connect, and to an instructions-only payload (no voice field) for
  live updates
- [done] Removed the broken Gemini live-instruction-update path entirely
  (`buildGeminiInstructionsUpdate` — caused WebSocket close 1007 on every
  parameter change); Gemini now always reconnects to apply any change,
  debounced so rapid slider drags collapse into one reconnect
- [done] Symmetric interrupt handling for both providers: local audio flush
  (`flushOutputAudio()`, tracks and stops scheduled `AudioBufferSourceNode`s)
  triggered by the authoritative signal from each provider (OpenAI
  `input_audio_buffer.speech_started` / `response.cancelled`; Gemini
  `serverContent.interrupted`), broadcast to projection/monitor for both
  manual 打斷 and automatic voice barge-in
- [done] Debounced automatic live-parameter push (attitude/state/sliders/prompt
  override) without requiring the `更新參數` button: pushed live in-place on
  OpenAI (unless voice changed, which reconnects), always reconnects on
  Gemini (debounced so rapid changes collapse into one reconnect, not one
  per slider tick)
- [done] Expandable character preset system (`characterPresets` in
  settings.js, `POST`/`DELETE /api/presets`) — save/load/overwrite/delete,
  not capped at a fixed count
- [done] Corrected OpenAI Realtime voice catalog (10 voices, `marin`/`cedar`
  marked recommended, `fable`/`onyx`/`nova` removed as unconfirmed) and full
  30-voice Gemini Live catalog — both providers have no live voice-list API,
  so these are accurate static data (`server/lib/provider-catalog.js`)
- [done] Live OpenAI/Gemini model fetching (`GET /api/settings/models`,
  `/api/settings/openai-voices`, `/api/settings/gemini-voices`), 10-minute
  in-memory cache, graceful fallback to a static seed list on any failure
- [done] Electron fullscreen crash fixed: removed nonexistent `setFrame()`
  call, wrapped in try/catch so a future window-API failure can't crash the
  whole app mid-show
- [done] Control window now opens at (60, 60) instead of OS default position

**Correction (same-day, live-tested):** initially switched fullscreen from
the crashing `setFrame()` call to `setKiosk()`, per an explicit choice to
prefer a more aggressive edge-to-edge surface. Live testing showed kiosk mode
only hid the menu bar without the window actually resizing to fullscreen —
this matches long-standing, still-open upstream Electron/macOS bugs
(electron/electron#35684, #38261, #1054) where dock/menu-bar hiding and the
actual fullscreen transition don't reliably happen together in kiosk mode.
Fixed by switching to the platform-native `setFullScreen()` instead — the
same mechanism every other fullscreen macOS/Windows app uses ("system
default" per the user's own suggestion), reliable, and simpler.

**Second correction (same session):** "save current settings to a preset"
silently did nothing in the real Electron app despite working in automated
browser tests. Root cause: `createNewPreset()` used `window.prompt()`, which
Electron does not implement at all — it throws `Error('prompt() is and will
not be supported.')` by explicit design (electron/electron#472), a
restriction that a Chromium-via-Playwright test against the bare Express
server never exercises, since that's a real browser tab, not an Electron
renderer. Fixed by adding a custom in-page modal dialog (`customPrompt()` /
`customConfirm()`, `#modal-overlay`) used for all three preset actions
(create/overwrite/delete confirmation), and verified directly inside a real
Electron `BrowserWindow` (not just Playwright/Chromium) that: `window.prompt()`
does throw as expected, the custom modal works correctly in that same
restricted renderer context, and the full create-preset flow persists
correctly through the real `/api/presets` endpoints end-to-end.
- [done] Unit tests (`tests/unit/`, Node's built-in `node:test`, no new
  dependency): `realtime-session.test.js`, `settings-presets.test.js`,
  `provider-catalog.test.js` — 28 tests, all passing
- [done] `tests/manual/app1-realtime.md` extended: live parameter update
  (both providers), presets, voice/model catalog accuracy, interrupt/barge-in
  (both providers), fullscreen + window layout
- [todo] Live rehearsal re-verification of all of the above against real
  OpenAI and Gemini sessions, with evidence recorded
- [todo] `conversation.item.truncate` on interrupt (deferred — keeps OpenAI's
  server-side conversation history precisely in sync with what was actually
  heard; not required for interrupt to work or sound correct live)

## Phase 9 — First Electron `.dmg` Build [done]

Produced the first working `ourT.dmg` build and fixed everything the build
process itself surfaced.

- [done] Fixed the build failing outright: `assets/dmg-background.png` was
  referenced in `ourT-electron/package.json` but never existed. Removed the
  reference (no design asset to fabricate) rather than leaving a broken
  config; the DMG now uses electron-builder's default window styling. Added
  the missing `author` field to clear a separate warning. `assets/icon.icns`
  is still unset (falls back to the default Electron icon) — documented in
  the README as a follow-up if custom branding is wanted later.
- [done] **Critical fix — secret exposure in build output:** the
  `extraResources` copy step bundled `server/settings.json`, including the
  real OpenAI/Gemini/Anthropic/Groq API keys from local dev, directly into
  the packaged `.app`/`.dmg`. Caught before any `git add`/commit or
  distribution — confirmed via `git status` that `ourT-electron/dist/` was
  still untracked, and there was also no `.gitignore` entry for it (`dist/`
  would have been committed and pushed on the next `git add -A`). Fixed by:
  (1) excluding `settings.json`/`.env` from the `extraResources` filter,
  which is also the functionally correct behavior — each install should
  populate its own `~/Library/Application Support/ourt/settings.json` on
  first launch, never ship the developer's own keys; (2) adding
  `ourT-electron/dist/` to `.gitignore`. Deleted the leaked build output and
  rebuilt clean; verified with a grep for the actual key string and a check
  for `settings.json` anywhere under the rebuilt `dist/` — both confirmed
  absent.
- [done] Verified the rebuilt `.app` actually launches and works: spawned it
  directly (not just `npm start`), confirmed the server starts, all four bus
  roles (main/monitor/control/projection) connect, and weather fetches
  succeed — then confirmed the separate, pre-existing, legitimate
  `~/Library/Application Support/ourt/settings.json` (the developer's own,
  from prior local sessions) is correctly outside both the repo and the
  built bundle.
- [done] Produced both `ourT-1.0.0-arm64.dmg` (Apple Silicon) and
  `ourT-1.0.0.dmg` (Intel), ~96–112 MB each, ad-hoc signed (no Developer ID
  configured), not notarized.
- [done] README.md updated: accurate Electron build instructions (output
  files, ad-hoc signing/Gatekeeper note, transient codesign-timestamp retry
  note, missing icon/background note), a settings-exclusion security note,
  refreshed AI Character section (both providers, live parameter behavior
  differences, presets, barge-in), corrected OpenAI voice table (was still
  the pre-Gemini 6-voice list), new Automated Tests section, updated
  Troubleshooting and Project Structure.
- [todo] Design real `assets/icon.icns` and a DMG background if custom
  branding is wanted before the actual performance run
- [todo] Apple Developer ID signing + notarization if the app needs to be
  distributed to a machine that isn't this development Mac (currently
  Gatekeeper requires a manual right-click-Open bypass)

## Phase 10 — Packaged-App Microphone Access [active]

User reported the mic and output audio tests not working after building —
narrowed to the packaged `.app` specifically (dev mode via `npm start` was
never actually affected).

Root cause: electron-builder signs with `hardenedRuntime` using its default
entitlements template (`com.apple.security.cs.allow-jit`,
`allow-unsigned-executable-memory`, `disable-library-validation` only). Apple
requires the additional `com.apple.security.device.audio-input` entitlement
for `getUserMedia({ audio: true })` to work at all under hardened runtime —
without it, macOS blocks microphone capture outright at the OS level,
regardless of `NSMicrophoneUsageDescription` or any permission the user
grants in the dialog. This is exactly why the same code path works fine in
unsigned dev mode (no hardened runtime there) but silently fails once built
and signed.

- [done] Re-verified the earlier API-key exclusion fix against the actual
  mounted `.dmg` (not just the loose `dist/mac-arm64/` folder): grepped for
  the real key pattern and searched for any `settings.json`/`.env` — both
  confirmed absent. The fix from Phase 9 is intact and working correctly.
- [done] Added `ourT-electron/build/entitlements.mac.plist` with
  `com.apple.security.device.audio-input` (plus the three pre-existing
  Electron-required entitlements), wired via `mac.entitlements` /
  `mac.entitlementsInherit` in `package.json`
- [done] Added an explicit Traditional Chinese `NSMicrophoneUsageDescription`
  via `mac.extendInfo` (previously relied on Electron's built-in English
  default)
- [done] Rebuilt and verified via `codesign -d --entitlements -` that the
  new entitlement is actually embedded in the signed binary, and re-verified
  (mounted `.dmg` scan) that no API keys leaked in this rebuild either
- [done] Verified the rebuilt app still launches and serves `/control`
  correctly (no regression from adding `hardenedRuntime`/entitlements)
- [done] `tests/manual/app1-realtime.md`: added a dedicated section for
  packaged-app microphone verification (entitlement check, real permission
  dialog, `tccutil reset` recovery step) — the actual OS permission grant and
  live speech capture can only be verified by a human with physical hardware
  against a real built `.dmg`, not automated
- [todo] Human verification with a freshly built `.dmg`: confirm the
  permission dialog appears with the correct zh-TW text, grant it, and
  confirm `測試麥克風` actually shows input movement
- [todo] If `測試輸出` (speaker test, which needs no entitlement at all) is
  still separately broken after this fix, that has a different root cause —
  report the exact error/status text so it can be diagnosed further

## Phase 11 — KTV: Song Search/Import + Sync Accuracy [active]

User asked about Spotify integration for song discovery + lyrics, given most
songs are Taiwanese. Researched Spotify's current (2026) developer terms in
depth: audio streaming for a theatre performance is legally blocked
(*"Spotify content may not be used to facilitate public or commercial
playback"*, confirmed by Spotify staff directly), there is no public lyrics
API at all (confirmed 403/staff response), and even personal-use streaming
requires every device to have Premium and prohibits synchronizing external
content with playback — exactly what the karaoke wipe effect does. Metadata
search (`GET /search?market=TW`) would have worked but was descoped by the
user in favor of trying YouTube search first (`yt-dlp`'s built-in `ytsearch`,
no API key needed) — deferred, not rejected; can be added later as an
additional metadata/cover-art source without touching the audio pipeline.

Scoped down to Phase 2 only per user's choice: sync accuracy improvements
and a YouTube search/import UI, no Spotify/Musixmatch integration.

- [done] Extracted pure LRC/timestamp logic into `server/lib/lyrics-sync.js`
  (`formatLrcTimestamp`, `parseLrc`, `toLrc`, `segmentsToLrc`,
  `refineSegmentTimestamps`, `applyLrcOffset`) — unit tested in isolation
- [done] Fixed a latent centisecond-rounding carry-over bug while making
  `formatLrcTimestamp` testable: a value like 59.999s previously rounded to
  the malformed `[00:59.100]` (3-digit ms field) instead of correctly
  carrying into `[01:00.00]` — same root formula existed in the original
  `segmentsToLrc`, just never caught because it wasn't unit tested before
- [done] Word-level Whisper timestamps: `import-song.js` (via the new shared
  `server/lib/song-importer.js`) now requests
  `timestamp_granularities: ["word", "segment"]` and uses
  `refineSegmentTimestamps()` to anchor each lyric line to its first word's
  actual start time rather than the segment's start time (which often
  includes leading silence/breath padding) — directly answers the user's
  "how to make Whisper sync more accurate" question, no new dependency
- [done] Refactored the import pipeline: `server/scripts/import-song.js` is
  now a thin CLI wrapper around `song-importer.js`'s `importSong()`, so the
  CLI and the new HTTP import endpoint share exactly one implementation
  (previously would have been duplicated)
- [done] `server/lib/youtube-search.js`: YouTube search via `yt-dlp`'s
  `ytsearch:` prefix — no YouTube Data API key/registration needed
- [done] New endpoints: `GET /api/songs/search`, `POST /api/songs/import` +
  `GET /api/songs/import/:jobId` (async job polling — download+transcribe
  takes 30-90s), `PATCH /api/songs/:id/offset`
- [done] Centralized catalog writes into `server/lib/song-queue.js`
  (`addSongToCatalog`, `updateSongOffset`) — previously each caller read/wrote
  `songs/index.json` independently; added `OURT_SONGS_CATALOG_PATH` env
  override for test isolation (mirrors `OURT_SETTINGS_PATH` in settings.js)
- [done] New `/control` UI: 搜尋並匯入歌曲 search box + result list with
  thumbnails, one-click import with async progress polling; 歌詞偏移 live
  offset slider (±2000ms, debounced) shown while a song is playing, resets
  per-song, persists to the catalog
- [done] Cleaned up a pre-existing duplicate `/api/songs/:id/cover` route
  registration found while adding the new song routes nearby
- [done] Projection applies `lrcOffset` live: `ktv.offset.update` bus event
  updates the currently-playing song's effective sync offset without
  interrupting playback or reloading lyrics
- [done] Unit tests: `lyrics-sync.test.js`, `youtube-search.test.js`,
  `song-queue.test.js` — 65 tests total across the whole suite, all passing.
  Verified live end-to-end against real `yt-dlp`: search for "周杰倫 稻香"
  returned real YouTube results with thumbnails in the actual `/control` UI;
  the offset PATCH endpoint and projection sync-offset math were verified
  live in-browser (positive offset measurably delays line triggering,
  negative advances it, clamped at 0)
- [done] `tests/manual/app3-ktv.md` extended: search/import UI section,
  live offset-tuning section, updated CLI import section to reflect the
  shared-pipeline refactor
- [todo] Manual end-to-end verification of a full real import (download +
  Whisper transcription + catalog update) through the `/control` UI, ideally
  once with an OpenAI key configured (word-level path) and once without
  (local whisper fallback, segment-level only)
- [todo] Rehearsal verification that `refineSegmentTimestamps` measurably
  improves perceived sync quality on a real song, not just unit-level
  correctness
- [todo] Revisit Spotify (metadata/cover-art only, not audio/lyrics) or
  Musixmatch as an additional source if YouTube-only search/import proves
  insufficient for song discovery or cover-art quality

## Phase 12 — KTV Live Controls + Packaged Build Expiry [active]

User reported that songs imported from `/control` did not show in already-open
song lists, requested explicit real-KTV `播放` / `切歌` controls, and requested
that distributed builds remain usable through 2026-09-01 only. This phase uses
TDD for queue and expiry logic; live playback and packaged-app cutoff require
manual verification.

- [done] Broadcast `catalog.updated` when a newly imported song is persisted;
  audience and control views refresh their catalog without reloading
- [done] Add explicit `播放` and `切歌` controls; 切歌 stops the current item and
  immediately starts the next queued item, or stops projection playback when
  no next item exists
- [done] Broadcast `queue.updated` after natural completion so all operator
  controls reflect the cleared current-song state
- [done] Enforce packaged-build expiry at local 2026-09-02 00:00 (allowing all
  of 2026-09-01); expiry prevents startup and closes a still-running packaged
  App, while development startup remains available
- [done] Unit tests cover catalog broadcasts, end/skip transitions, expiry
  boundary, packaged-only policy, and bounded expiry scheduling
- [todo] Manual KTV verification: complete a real import with audience/control
  pages already open, then verify 播放, 切歌 to next song, and 切歌 with an empty queue
- [todo] Manual packaged-app verification: launch before expiry and confirm
  windows open; verify expiry dialog/no server startup after cutoff and auto-quit
  when crossing the cutoff

## Phase 13 — Packaged KTV Media Storage [active]

User reported that a newly imported song could not play and no lyrics appeared
on Projection. The imported catalog, MP3, and LRC were present and internally
consistent, ruling out a download/ID mismatch. Root cause: packaged Electron
started the server from `Resources/server`, while the importer and media routes
resolved songs relative to that bundled location instead of a user-writable,
persistent runtime directory; Projection also silently swallowed media errors.

- [done] Add shared `song-storage` paths used by catalog, importer, media
  routes, and lyric-generation script
- [done] On packaged first launch, seed `~/Library/Application Support/ourt/songs`
  from bundled media; later launches preserve imported catalog/audio/LRC files
- [done] Pass the writable songs directory to the packaged server through
  `OURT_SONGS_DIR`; development continues using repository `songs/`
- [done] Show audio and lyric fetch/playback errors directly on Projection and
  in its developer console instead of silently rendering an empty KTV screen
- [done] Unit tests verify runtime seeding and imported-media preservation
- [todo] Manual packaged-app verification: import a song, point/play it, confirm
  audible audio and lyrics; relaunch and confirm the song remains available

## Phase 14 — KTV Playback Delivery Reliability [active]

Follow-up report: selecting a song and pressing `播放` had no observable result.
The previous endpoint marked a queue item as playing before confirming that a
Projection client was connected, and Projection only received a transient play
event, leaving it blank after a load/reconnect race.

- [done] Allow Play before Projection connects; Control displays live Projection
  status and warns that playback will begin when Projection connects
- [done] Replay the current `ktv.play` item when Projection connects or reconnects
- [done] Prevent duplicate Play requests from replacing the active song
- [done] Keep KTV controls disabled until an authoritative queue state arrives;
  temporary button feedback now restores the state-derived disabled status
- [done] Unit test that a second dequeue preserves the active song and queue order
- [todo] Manual packaged-app verification: request a song with Projection open,
  press Play, reload Projection mid-song, and confirm audio/lyrics resume

## Phase 15 — Control-Panel Song Selection [active]

User requested direct operator song selection instead of requiring the audience
page for every playback. This is an operator UI feature using the existing,
unit-tested queue APIs; end-to-end media behavior remains covered by the KTV
manual protocol.

- [done] Add a Control catalog selector that refreshes after imports
- [done] Add 加入佇列 for operator-requested songs
- [done] Add 播放此歌: queues and starts the selected song when idle; queues it
  without interrupting an active song otherwise
- [done] Open or focus the audience song-request popup whenever Control enters
  KTV mode (Electron uses a reusable native window; browsers use a popup)
- [todo] Manual packaged-app verification: select, queue, and directly play a
  catalog song from Control, both while idle and while another song is active;
  switch into KTV and confirm the Audience popup opens once

## Phase 16 — Packaged yt-dlp Discovery [active]

User reported `搜尋失敗：spawn yt-dlp ENOENT` in the packaged App. The machine
has `yt-dlp` at `/opt/homebrew/bin/yt-dlp`; Finder-launched Electron did not
inherit the interactive shell PATH containing that directory.

- [done] Pass Apple Silicon and Intel Homebrew bin directories to the packaged
  server PATH, covering both search and audio download
- [done] Replace raw ENOENT output with an actionable zh-TW install/restart
  message
- [done] Unit test the missing-executable error path
- [todo] Manual packaged-app verification: search YouTube after rebuilding and
  confirm `yt-dlp --version` is discoverable through the Control search flow

## Phase 17 — Concise Information Replies [active]

User clarified that audience labels are only one example: at times they need
concise information organization during the AI dialogue, rather than a long
conversational extension. This is a Realtime instruction feature, not KTV
analysis.

- [done] Add `精簡資訊回覆` Control toggle: information requests receive 1–3
  short sentences with no questions, invitations, advice, or topic extension
- [done] Apply the change live for OpenAI and through the existing clean Gemini
  reconnect path
- [done] Persist the mode in AI character presets and verify create, overwrite,
  and reload behavior with a unit test
- [todo] Manual OpenAI/Gemini rehearsal verification: toggle mode during an
  active session, request a label/summary/observation, confirm concise direct
  output, then disable it and confirm normal dialogue resumes

## Phase 18 — AI Settings Completeness, KTV/AI Exclusivity, Memory, Voice Tools [active]

User requested a broad set of AI dialogue improvements in one pass: (A) make
sure every AI-related setting is actually configurable in Control's 系統設定,
(B) automatically stop the AI conversation while KTV plays and resume it
after, (C) short-term conversational memory so parameter changes/reconnects
don't feel like total amnesia, (D) let the performer adjust the AI's response
length by voice instead of only via a Control checkbox, (E) give the AI
Realtime conversation access to a specific real historical dataset (Taiwan
LGBT movement events) it previously couldn't see at all, (F) let the
performer voice-request a KTV song search+download before switching into
karaoke, and (G) settings toggles for the two riskiest new capabilities. Full
TDD for every piece of pure, extractable logic (`server/lib/realtime-session.js`,
`server/lib/voice-import-guard.js`); WebSocket/DOM orchestration
(`realtime-proxy.js`, `control/index.html`) follows this codebase's existing,
deliberate boundary and is manual-protocol verified instead
(`tests/manual/app1-realtime.md` sections 5e-5j, `app3-ktv.md` section 9).

### A — AI settings completeness
- [done] Added `Claude`/`Groq`/`Mistral`/`OpenAI 文字模型` dropdowns to
  `系統設定` (server already supported all four via `getModelsForProvider`;
  only the UI wiring was missing) — de-duplicated the `openaiText` static
  list against its own default value
- [done] Added a `歌曲分析自訂提示` override (`ktv.songAnalysisPrompt` in
  settings.js), mirroring the existing lyrics-rewrite custom-prompt pattern
- [done] Removed the dead `yolo.model` default (never read anywhere — the
  real YOLO pipeline uses `app2-yolo/config.yaml` instead); noted that
  existing `settings.json` files may still carry a stale copy of this key
  via `deepMerge`, which is harmless (unused) rather than actively purged
- [todo] Manual verification: each new dropdown persists and is actually used
  by a live provider call; the song-analysis prompt override changes output

### B — KTV / AI Realtime mutual exclusion
- [done] `didKtvStart`/`didKtvEnd` pure decision functions
  (`realtime-session.js`) — deliberately do NOT fire on a skip directly from
  one song to another (AI is already disconnected, stays disconnected)
- [done] Control's `queue.updated` handler calls `closeSession()` when a song
  starts (only if a session was active) and `startSession()` again when it
  ends (only if that pause was KTV-caused, tracked via a `pausedForKtv` flag)
- [done] `結束` now calls `endSessionManually()` — an explicit operator stop
  distinct from the KTV-triggered pause; only this clears short-term memory
- [todo] Manual verification: start→play→auto-pause→song ends→auto-resume;
  confirm a skip between two songs does not spuriously reconnect

### C — Short-term rolling memory across reconnects
- [done] Every reconnect (Gemini parameter change, OpenAI voice change, KTV
  pause/resume) opens a brand-new browser→server WebSocket, so the buffer
  lives in Control's `state.recentTranscript` (survives those cycles),
  capped to the last 8 turns (~4 exchanges) — deliberately bounded, not a
  full transcript
- [done] `appendTranscriptTurn`, `buildGeminiSeedTurns` (raw `clientContent`
  seeding — confirmed via Gemini's own docs as the supported mechanism, unlike
  the `role:"system"` live-update that's confirmed broken), and
  `buildOpenAISeedItems` (`conversation.item.create`, correct
  `input_text`/`output_text` content type per role) in `realtime-session.js`
- [done] Seeding wired into `connectToOpenAI()`'s `ws.on('open')` (fires
  exactly once per real OpenAI connection — NOT the `session.updated` ack,
  which also fires on every later live update) and Gemini's `setupComplete`
  handler
- [done] Control accumulates `transcript.user.delta/.done` (previously
  unhandled entirely) and `transcript.ai.delta/.done` into the buffer;
  cleared only by `endSessionManually()`
- [todo] Manual verification: a reconnect (either provider) doesn't start the
  conversation cold; an explicit 結束 does clear memory; only ~4 exchanges
  are retained even after a much longer conversation

### D — Voice-triggered response length (tool/function calling)
- [done] Generalized the `精簡資訊回覆` boolean into a shared tri-state
  `responseLength` ('concise'|'normal'|'expanded') — the manual checkbox
  still only reaches concise/normal (unchanged UI meaning); `expanded` is
  reachable only via voice; character presets still persist the original
  boolean field (`conciseInformationMode`) for backward compatibility
- [done] `set_response_length` tool declared via `buildResponseLengthTool`
  (OpenAI) / `buildResponseLengthFunctionDeclaration` (Gemini) — confirmed
  current wire schemas via Context7 (OpenAI `session.tools` array with
  `type:"function"`; Gemini bare `functionDeclarations` inside
  `tools:[{functionDeclarations}]`)
- [done] Applied live on OpenAI (`conversation.item.create` function output +
  `buildOpenAIInstructionsUpdate`, no reconnect); applied via a
  server-initiated reconnect on Gemini (tool-response channel is moot since
  the connection is closing anyway) — idempotent via a marker that strips any
  prior voice-triggered fragment before appending the new one, so repeated
  voice requests in one session don't accumulate conflicting instructions
- [done] Broadcasts `ai.responseLength`; Control updates its own state/checkbox
  so a later operator-driven instruction rebuild doesn't silently overwrite
  what the voice command just set
- [todo] Manual verification (both providers): voice-triggered shorter/longer
  requests actually change behavior; OpenAI applies without a visible
  reconnect, Gemini reconnects once; repeated requests don't duplicate rules

### E — RAG: Taiwan LGBT movement history
- [done] Added `server/rag/taiwan-lgbt-history.md` (1990 我們之間成立, 1992
  台視新聞世界報導/T Bar 偷拍事件, 1997 常德街事件, 1998 AG 健身中心事件, 1999
  Corners 酒吧臨檢事件, 2000 北投 24 會館三溫暖事件) with an explicit framing
  note asking the AI to treat this with gravity and not fabricate details
  beyond what's recorded — same shared `server/rag/` folder already used by
  lyrics rewrite/song analysis (confirmed by user's choice: affects all three)
- [done] New `GET /api/rag/context` — the Realtime AI conversation
  previously had zero access to `server/rag/*.md` at all (only lyrics
  rewrite/song analysis did); Control fetches this once at startup and
  appends it into `buildInstructions()` behind a "reference only when
  relevant, don't recite unprompted" framing line
- [done] Verified combined RAG size (~2.6KB) stays well under the existing
  4000-char cap in `loadRagContext()`
- [todo] Manual verification: AI accurately references these events when
  asked, stays silent about them when irrelevant, and doesn't fabricate
  unrecorded specifics

### F — Voice-triggered song search + import
- [done] Two tools: `search_song` (fast/synchronous, returns candidates for
  the model to read back for confirmation) and `import_requested_song`
  (starts the existing 30-90s async download+transcribe pipeline; tool
  description explicitly instructs the model to confirm with the performer
  first) — declared via `buildSearchSongTool`/`buildImportSongTool`
  (OpenAI) and their `*FunctionDeclaration` Gemini equivalents
- [done] `server/lib/voice-import-guard.js` — module-level cap (default 5)
  on voice-triggered imports per server run, separate from the uncapped
  operator-driven `/control` search+import UI
- [done] Reuses the existing `songImporter.importSong()`/catalog pipeline;
  per user's decision, only adds to the catalog — never auto-enqueues into
  the KTV queue, preserving operator review
- [done] Completion (or failure) announced back into the live conversation
  via the same `clientContent`/`conversation.item.create` channel built for
  short-term memory seeding (C) — reuses `buildGeminiSeedTurns` directly for
  the Gemini announcement
- [todo] Manual verification against real `yt-dlp`/Whisper: search→confirm→
  download→spoken completion announcement→catalog (not queue) update; the
  6th voice-triggered import in one run is correctly refused

### G — Settings toggles for the two riskiest capabilities
- [done] Per user's choice, only `voiceLengthControl` (default **on**) and
  `voiceSongImport` (default **off** — opt-in given real cost/time/risk) are
  exposed as toggles; KTV auto-disconnect/reconnect and short-term memory
  stay always-on with no settings UI
- [done] New standalone Control settings block "AI 對話功能開關", separate
  from the main `系統設定` grid, with its own save button and an explicit
  "requires session restart to apply" hint (tool declarations are
  connect-time-only on both providers, same constraint as a voice change)
- [todo] Manual verification: each toggle actually adds/removes its tool from
  a live connect payload; the "needs restart" hint is accurate

### Tests (all in this phase, all passing)
- [done] `realtime-session.test.js` extended: 44 new assertions across
  short-term memory, KTV/AI exclusion decisions, and both new tool families
- [done] New `voice-import-guard.test.js` (4 tests)
- [done] Full suite: 99 unit tests passing, 0 failing
- [done] Live smoke test: fresh server boot, `/api/rag/context`,
  `/api/settings` (`aiFeatures` present, correct defaults), and
  `/api/settings/models?provider=openaiText|claude` all verified manually
  against a running instance before commit

## Phase 10 — Attribution and License [done]

- [done] Add Creative Commons Attribution 4.0 license and developer metadata
- [done] Show developer and license information in Electron's About panel
- [done] Verify package metadata, Electron main-process syntax, 99 unit tests,
  and arm64/x64 DMG builds

## Phase 11 — AI Feature Toggle Styling [done]

- [done] Restyle AI feature toggles as outlined rectangular controls
- [done] Verify enabled and disabled controls retain the existing checkbox IDs
  and save behavior; 99 unit tests pass and `git diff --check` is clean

## Phase 12 — Concise Reply Toggle Styling [done]

- [done] Reuse the outlined AI feature toggle style for 精簡資訊回覆
- [done] Verify the live update checkbox behavior remains unchanged; 99 unit
  tests pass and `git diff --check` is clean

## Phase 13 — Remove Unavailable Sample Song [done]

- [done] Remove the bundled unavailable sample song from the KTV catalog
- [done] Add a regression test preventing it from being selectable again;
  confirmed red first, then 100 unit tests passing

## Phase 14 — Secure Electron Build [done]

- [done] Rebuild arm64 and x64 Electron DMGs
- [done] Confirm bundled resources exclude `settings.json` and `.env`
- [done] Scan generated App bundles for secrets without exposing values:
  `Resources/server` is clean on both architectures. The only three fully
  redacted whole-bundle matches are Electron's upstream `resources.pak`, not
  ourT files or user credentials.

## Phase 15 — Realtime Recovery, Lyrics Reliability, and Stage Script [active]

- [done] Add failing tests for Gemini reconnect recovery, lyrics variants, and stage-script navigation
- [done] Recover Gemini sessions after unexpected provider setup closures
- [done] Remove unused Node Control YOLO settings and legacy values
- [done] Make generated lyrics valid, persistent, and reliably selectable on Projection
- [done] Add generated stage-script reading mode with previous/next controls
- [done] Run 112 unit tests and build arm64/x64 Electron DMGs
- [done] Migrate retired Gemini 2.5 text-model selections to `gemini-3.5-flash`
- [todo] Manual Gemini verification: concise mode/character changes recover to `◉ 通話中`; manual end and KTV pause do not retry
- [todo] Manual lyrics verification: generated variant before/during playback, Projection reload, server restart, custom rule, and malformed LRC rejection
- [todo] Manual Projection verification: stage-script legibility, previous/next boundaries, reconnect recovery, and KTV exit to AI view

## Phase 16 — Live Model Catalogs, Script Casting, and Realtime Playback [active]

- [done] Add failing tests for live text-model filtering and stage-script contracts
- [done] Fetch account-available text models for all supported providers
- [done] Enforce script length and configure cast/system role with server-authoritative pages
- [done] Bound audio playback and discard stale provider/session output
- [done] Run 115 unit tests, package arm64/x64 Electron DMGs, and update manual verification protocols
- [todo] Manual verification: real provider catalog lists, 1,000+ character scripts with cast rules, and long-response/reconnect audio stability
