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
