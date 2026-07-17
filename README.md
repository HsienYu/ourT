# ourT — Theatre Performance Apps

Three apps for live performance, all running locally on a Mac.

---

## Architecture

| Server | Port | Apps |
|---|---|---|
| Node.js | 3000 | App 1 (AI Character) + App 3 (KTV) |
| Python FastAPI + PyQt6 | 3001 | App 2 (YOLO Camera) |

---

## Quick Start (Development)

```bash
# One command starts everything:
./start.sh

# Or start manually:
# Terminal 1 — Node.js server
cd server && npm start

# Terminal 2 — YOLO GUI (optional)
cd app2-yolo && source venv/bin/activate && python app.py
```

The terminal prints your local network URLs:

```
  Operator panel:  http://192.168.x.x:3000/control
  Projection:      http://192.168.x.x:3000/projection
  Monitor:         http://192.168.x.x:3000/monitor
  Audience:        http://192.168.x.x:3000/audience
  YOLO panel:      http://192.168.x.x:3001/panel
```

---

## Setup

### 1. API Keys and Settings

Start the app, open `/control`, then expand `系統設定`. The Control UI is the only normal editor for API keys, models, KTV options, and audio devices.

Electron stores the canonical configuration in `~/Library/Application Support/ourt/settings.json`. Development mode stores it in `server/settings.json`. Both files are ignored by Git.

### 2. Node.js dependencies

```bash
cd server && npm install
```

### 3. Python venv (App 2)

```bash
cd app2-yolo
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## Pages

| URL | Device | Purpose |
|---|---|---|
| `/projection` | Projection screen (full-screen browser) | Audience-facing: AI text + KTV lyrics |
| `/monitor` | Stage monitor or tablet facing performer | Performer cues: MIC live, AI state, transcript, params |
| `/control` | Operator phone/tablet | Full control panel: AI, KTV queue, lyrics editor |
| `/audience` | Audience phones | Song request page |
| `localhost:3001/panel` | Operator monitor | YOLO bias, labels, toggles, live preview |
| `localhost:3001/preview` | Any browser | MJPEG annotated camera feed |

---

## App 1 — AI Character (OpenAI Realtime or Gemini Live)

Either provider is selectable in `/control` → `系統設定` → `Realtime 語音提供者`.

### Operator flow

1. Open `/control` on phone or tablet
2. Select voice, attitude, emotional state, personality sliders
3. Tap **開始 / 連線** — browser requests mic, proxies to the selected provider
4. Performer speaks — AI responds via speaker; text streams on projection, labelled 演員/AI
5. **Monitor page** (`/monitor`) shows mic live, AI state, and current params for the performer
6. Adjust attitude/state/sliders/prompt override → pushed live automatically (debounced ~400ms), no button needed. Behavior differs by provider: OpenAI updates in place; **Gemini Live has no live-update mechanism at all and always reconnects** to apply any change (its `setup` message — voice, model, instructions — is one-time only). Voice changes always reconnect on both providers.
7. **打斷 AI** interrupts current AI response instantly (also triggers automatically when the performer talks over the AI — barge-in)
8. **清除投影文字** wipes the projection screen
9. **AI 角色預設**: save the current voice/attitude/state/sliders/prompt as a named, numbered preset for instant recall during the show; expandable list, not capped at 4

### Voice options

Neither provider exposes a live "list voices" API — both catalogs below are
the full, current, accurate lists from each provider's own documentation
(`server/lib/provider-catalog.js`), shown live in `/control`'s voice grid and
`系統設定` dropdown.

**OpenAI Realtime** (10 voices — `fable`/`onyx`/`nova` are TTS-only and not
confirmed working on the current Realtime model, so they're excluded):

| Voice | Character feel |
|---|---|
| marin, cedar | 推薦（最新／最自然，OpenAI 官方建議） |
| alloy | 中性 |
| ash, echo | 中性偏男 |
| ballad | 柔和 |
| coral, shimmer | 溫柔女 |
| sage | 沉穩 |
| verse | 表現力強 |

**Gemini Live**: 30 prebuilt voices (Puck, Charon, Kore, Fenrir, Aoede, …) —
see the `Gemini Live 聲音` dropdown in `系統設定` for the full list.

Realtime/live model dropdowns (`OpenAI Realtime 模型`, `Gemini Live 模型`,
`Gemini 文字模型`) are fetched live from each provider's real `models.list`
API (cached ~10 minutes, falls back to a static list if offline or no key).

### Performer cues (visible on `/monitor`)

| State | Indicator |
|---|---|
| Mic is live (performer speaking) | Green dot + `你的回合` |
| AI thinking | Yellow dot wave + `思考中…` |
| AI speaking | Purple dot + `說話中…`, rolling transcript |
| AI done | Green + `完成` (fades after 2s) |
| Interrupted | `已打斷` |

### Projection ambient cues (aesthetic, audience also sees)

- Small dot top-left pulses during mic-active
- Transcript border: dim when performer's turn, accent colour when AI responds
- Cursor: three-dot wave when AI thinking, fast blink when streaming

---

## App 3 — KTV

### Add songs

#### Option A: Import from YouTube (recommended)

```bash
cd server
node scripts/import-song.js \
  --url "https://youtube.com/watch?v=..." \
  --title "愛你" \
  --artist "張惠妹" \
  --tags "流行,愛情"
```

Requires: `brew install yt-dlp ffmpeg`

#### Option B: Manual

1. Add `.mp3` to `songs/audio/<id>.mp3`
2. Add `.lrc` to `songs/lyrics/<id>.lrc`
3. Add cover image to `songs/covers/<id>.jpg` (optional)
4. Add entry to `songs/index.json`

#### LRC format

```
[00:12.34]第一行歌詞
[00:16.00]第二行歌詞
```

### LLM lyrics rewrite

```bash
# Pre-generate all variants for all songs before the performance:
cd server
node scripts/generate-lyrics.js

# One song, one variant:
node scripts/generate-lyrics.js --song <id> --variant gender-swap

# Force regeneration:
node scripts/generate-lyrics.js --force
```

Variants: `gender-swap` (性別互換), `emotional` (情緒放大), `distorted` (超現實扭曲)

**Auto-rewrite on audience request:** Enable `KTV 自動改寫` in `/control` → `系統設定`.
The LLM rewrites lyrics in the background when a song enters the queue.  
If completed before the song plays, modified lyrics appear immediately.  
If still generating, original plays first and lyrics swap mid-song automatically.

**RAG context:** Place performance concept documents (`.md` or `.txt`) in `server/rag/`.  
Claude reads them before every rewrite to align the lyrics with the show's artistic intent.

### KTV operator flow

1. Audience requests songs on `/audience`
2. Queue appears in operator panel
3. Tap **播放下一首** to play
4. Toggle **歌詞模式：整行 / 掃光** for line-highlight vs karaoke wipe
5. **Lyrics Editor** section: select variant, generate with LLM, or edit LRC directly and push to projection
6. Tap **他點這首歌有什麼樣的傾向？** (operator or audience) for Claude analysis overlay

### KTV variant wipe colours

| Variant | Wipe colour |
|---|---|
| original | Pink |
| gender-swap | Cool blue |
| emotional | Warm orange |
| distorted | Purple |

---

## App 2 — YOLO Camera

### Run (standalone GUI)

```bash
cd app2-yolo
source venv/bin/activate
python app.py   # GUI window + embedded web server on port 3001
```

Or headless (web server only):

```bash
python main.py
```

### Labels shown on each detected person

- Gender expression: 男性化 / 女性化 / 中性 / 不確定性 + score 0–100
- 高/中/矮 (height from bounding box ratio)
- Clothing colour
- Posture: 直立 / 收縮
- 職業投射 (artistic social projection, stable per track ID)
- 膚色: 不判定 (intentionally not inferred)
- Image light: 暖光 / 冷光 / 中性光 etc.

### Operator controls (`/panel` or GUI sidebar)

- **Bias slider** (−50 to +50): push all labels toward masculine or feminine
- **震盪模式**: bias drifts sinusoidally — labels shift over time
- **隨機擾動**: per-person random jitter
- **Custom labels**: rename 男性化/女性化/中性/不確定性 live
- **NDI / Syphon toggles**: send annotated feed to VJ software

### NDI/Syphon output to VJ software

Set in `app2-yolo/config.yaml`:

```yaml
output:
  ndi_enabled: true
  ndi_name: "ourT-YOLO"
  syphon_enabled: false
```

NDI requires the [NDI SDK](https://ndi.video/for-developers/ndi-sdk/) and `pip install ndi-python`.

### Build as macOS .app

```bash
cd app2-yolo
pip install py2app
python setup.py py2app
# Output: dist/ourT YOLO.app
```

---

## Electron App (App 1 + 3)

Bundles the Node.js server into a native macOS `.app`.  
Three windows open automatically: Projection, Monitor, Control (opens at position 60, 60).  
Tablet/phone access still works via local WiFi.

```bash
cd ourT-electron
npm install
npm start          # development — forks server, opens all 3 windows
npm run build      # builds both dist/*.dmg (see below)
```

`npm run build` runs `electron-builder --mac`, producing two universal-Mac
installers under `ourT-electron/dist/`:

- `ourT-1.0.0-arm64.dmg` — Apple Silicon
- `ourT-1.0.0.dmg` — Intel

Both `.app` bundles are ad-hoc code-signed (no Apple Developer ID configured)
and **not notarized** — macOS Gatekeeper will warn on first launch; right-click
→ Open once to bypass. If `codesign` fails with *"A timestamp was expected but
was not found"*, that's a transient Apple timestamp-server issue — just
re-run `npm run build`.

`ourT-electron/dist/` is git-ignored and should never be committed or shared
as-is (see Security note below).

**No custom app icon or DMG background image are configured yet** —
`assets/icon.icns` and a DMG background were referenced in
`ourT-electron/package.json` but don't exist, so the build falls back to the
default Electron icon and a plain DMG window. Add real assets there and point
`build.mac.icon` / `build.dmg.background` at them if you want custom branding.

### Runtime settings and security

API keys and all runtime settings are read from `~/Library/Application Support/ourt/settings.json` and edited in `/control`. The Electron tray item `開啟系統設定` opens that UI. Existing legacy `server/settings.json` values and `.env` keys are imported once when this JSON file is first created — **only during local development**, never inside a built app.

`server/settings.json` (your local dev API keys) is explicitly excluded from
the `extraResources` copy step in `ourT-electron/package.json` (`!settings.json`
in the filter). A built `.app`/`.dmg` therefore never bundles your local keys —
each install starts clean and populates its own `~/Library/Application
Support/ourt/settings.json` on first launch. If you ever see `settings.json`
inside a built app's `Contents/Resources/server/`, that filter has regressed —
delete `dist/` and fix `extraResources` before distributing anything. Verify
with: `hdiutil attach dist/*.dmg -nobrowse -quiet -mountpoint /tmp/ourt-check && find /tmp/ourt-check -name settings.json && hdiutil detach /tmp/ourt-check`.

### Microphone access in the packaged app

The build is signed with `hardenedRuntime: true`, which requires the
`com.apple.security.device.audio-input` entitlement (in
`ourT-electron/build/entitlements.mac.plist`) for
`navigator.mediaDevices.getUserMedia({ audio: true })` to work at all —
without it, macOS silently blocks microphone capture regardless of the
`NSMicrophoneUsageDescription` prompt or any permission the user grants. This
only affects the signed `.app`/`.dmg`; unsigned dev mode (`npm start`) was
never affected. If mic access still doesn't work after installing a fresh
build: check System Settings → Privacy & Security → Microphone for ourT, or
reset the decision with `tccutil reset Microphone com.ourt.performance` and
relaunch.

---

## Pre-Performance Checklist

- [ ] API keys and provider/model selection verified in `/control` → `系統設定`
- [ ] At least 3 songs in `songs/index.json` with audio + LRC
- [ ] LLM lyrics variants pre-generated: `node scripts/generate-lyrics.js`
- [ ] `server/rag/` contains performance concept documents
- [ ] YOLO model downloaded: `app2-yolo/pose_landmarker_lite.task`
- [ ] `/control`, `/projection`, `/monitor` open and connected (green badge)
- [ ] Test mic: speak → transcript appears on projection within 2s
- [ ] Test KTV: request a song → plays on projection with lyrics
- [ ] Full manual verification: `tests/manual/`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No realtime provider available | Missing API key | Open `/control` → `系統設定`, enter and save a provider key |
| `AI 未開始` badge stays after tapping 開始 | Mic permission denied | Check browser permissions |
| Transcript never appears on projection | `/projection` not connected to bus | Refresh `/projection` page |
| `MediaPipe: model not found` | Missing `.task` file | Run `python -c "from processors.yolo_detector import _ensure_model; _ensure_model()"` in venv |
| LRC lyrics not syncing | LRC timestamps mismatch | Adjust `lrcOffset` in `songs/index.json` (seconds) |
| KTV auto-rewrite not working | Auto-rewrite disabled | Enable KTV 自動改寫 in `/control` → `系統設定` |
| NDI stream not visible | NDI SDK not installed | Download from ndi.video, then `pip install ndi-python` |
| Projection fullscreen toggle only hides the menu bar, doesn't resize | Fixed — uses platform-native `setFullScreen()`, not kiosk mode (kiosk had known Electron/macOS reliability bugs) | Update to latest; if still stuck, check the Electron main-process console for `[main] projection fullscreen →` log lines |
| Saving an AI character preset silently does nothing in the packaged app | Fixed — Electron does not implement `window.prompt()` at all; preset naming now uses an in-page modal | Update to latest; verify in the actual `.app`, not just a browser tab, since `window.prompt()` works fine in a regular browser but throws in Electron |
| Gemini Live disconnects every time a parameter changes | Expected, not a bug — Gemini's public Live API has no live-update mechanism at all, so any parameter change reconnects | Confirm the console shows a clean `1000` close, not `1007 Request contains an invalid argument`, which would indicate a regression |
| 測試麥克風 / mic input doesn't work in the packaged `.app` (worked fine in `npm start`) | Fixed — hardened-runtime code signing needs the explicit `com.apple.security.device.audio-input` entitlement, or macOS blocks mic capture outright regardless of the permission dialog | Rebuild with latest; verify with `codesign -d --entitlements - ourT.app` shows `com.apple.security.device.audio-input`; if still blocked, `tccutil reset Microphone com.ourt.performance` and relaunch |

---

## Automated Tests

```bash
cd server && npm test
# or from repo root:
node --test tests/unit/*.test.js
```

Pure-logic unit tests (Node's built-in `node:test`, no extra dependency) — see
`tests/unit/README.md`. Covers session payload builders, the per-provider
reconnect decision, preset CRUD, and provider-catalog fetch/cache/fallback
logic. Anything requiring a live provider connection, real audio hardware, or
the actual Electron app is covered by the manual protocols in `tests/manual/`
instead.

---

## Project Structure

```
ourT/
  server/                       # Node.js backend + frontend (Apps 1 + 3)
    index.js                    # Express + WS server
    lib/
      realtime-proxy.js         # OpenAI Realtime / Gemini Live WebSocket bridge
      realtime-session.js       # Pure session payload builders + reconnect decision (unit-tested)
      provider-catalog.js       # Voice catalogs + live OpenAI/Gemini model fetching
      settings.js                # Runtime settings + character preset persistence
      weather.js                # OpenMeteo fetch (Chiayi)
      song-queue.js             # KTV queue
    public/
      control/index.html        # Operator control panel
      control/pcm-processor.js  # AudioWorklet (mic PCM16)
      projection/index.html     # Shared projection screen (AI + KTV)
      monitor/index.html        # Performer stage monitor
      audience/index.html       # Audience song request
    rag/                        # RAG context docs for LLM lyrics rewrite
    scripts/
      generate-lyrics.js        # Pre-generate LLM lyrics variants (CLI)
      import-song.js            # yt-dlp + Whisper song import (CLI)
  app2-yolo/                    # Python YOLO camera
    app.py                      # PyQt6 standalone GUI (+ embedded FastAPI)
    main.py                     # Headless FastAPI web server
    pipeline.py                 # Shared detection pipeline
    config.yaml                 # Camera, YOLO, heuristics, labels, output config
    setup.py                    # py2app bundle config
    processors/
      camera_source.py          # Webcam / NDI / Syphon input
      yolo_detector.py          # YOLOv8 + MediaPipe Pose
      gender_heuristics.py      # Visual/social label heuristics
    output/
      ndi_output.py             # NDI video send
      syphon_output.py          # Syphon video send (macOS)
  ourT-electron/                # Electron bundle (App 1 + 3)
    main.js                     # Electron main process
    package.json                # electron-builder config
    dist/                       # Build output (.dmg, git-ignored — never bundles settings.json)
  songs/
    index.json                  # Song catalog
    audio/                      # .mp3 files (git-ignored)
    lyrics/                     # .lrc files + LLM variants
    covers/                     # Cover art (git-ignored)
  experiments/                  # Prototypes / spikes
  tests/
    unit/                       # Automated pure-logic tests (node:test)
    manual/                     # Manual verification protocols
  start.sh                      # Dev launcher
  PLAN.md                       # Implementation plan
```
