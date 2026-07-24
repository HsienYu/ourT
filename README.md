# ourT — Theatre Performance Apps (lite)

Two apps for live performance, all running locally on a Mac.

Developed by chenghsienyu. Licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

This is the **lite** branch: KTV/karaoke, stage-script generation, 精簡資訊回覆
(concise reply mode), and voice-triggered tool calling (response length,
song search/import) have all been removed — along with their entire UI
sections, server routes, and libraries — to keep the app smaller and the
realtime AI connection more robust. Only the AI Realtime conversation
(App 1) and the YOLO camera (App 2) remain.

---

## Architecture

| Server | Port | Apps |
|---|---|---|
| Node.js | 3000 | App 1 (AI Character) |
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
  YOLO panel:      http://192.168.x.x:3001/panel
```

---

## Setup

### 1. API Keys and Settings

Start the app, open `/control`, then expand `系統設定`. The Control UI is the only normal editor for the OpenAI/Gemini API keys, models, and audio devices.

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
| `/projection` | Projection screen (full-screen browser) | Audience-facing: AI transcript |
| `/monitor` | Stage monitor or tablet facing performer | Performer cues: MIC live, AI state, transcript, params |
| `/control` | Operator phone/tablet | Full control panel: AI settings and session control |
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

### Short-term memory

The AI remembers roughly the last 4 exchanges — bounded on purpose, not the
whole conversation. This is what's carried across a reconnect (a Gemini
parameter change or an OpenAI voice change) so the AI doesn't feel like it
forgot everything mid-show. Tapping 結束 clears it intentionally; the next
開始/連線 starts fresh.

### Connection reliability

Three fixes keep the AI conversation from silently stopping:

- A Gemini provider error now always sends a matching completion signal, so
  Projection and Monitor never get stuck showing "thinking"/"speaking" forever.
- The operator control panel never forwards a live parameter update to a
  realtime connection that isn't actually open.
- Tapping **開始 / 連線** always resets the automatic-reconnect budget, so a
  session that already exhausted its 3 automatic retries can still be
  restarted manually instead of failing immediately again.

### RAG: background reference material

`server/rag/*.md` (演出概念 + 台灣同志運動歷史事件，見
`server/rag/taiwan-lgbt-history.md`) is available to the live AI conversation
via `GET /api/rag/context` — the AI references it only when a conversation
naturally touches on those topics, not by reciting it unprompted.

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

Realtime/live model dropdowns (`OpenAI Realtime 模型`, `Gemini Live 模型`) are
fetched live from each provider's real `models.list` API (cached ~10
minutes, falls back to a static list if offline or no key).

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

## Electron App (App 1)

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

Packaged builds remain usable through **2026-09-01** in the Mac's local time.
At `2026-09-02 00:00`, the packaged App shows an expiry message and quits; an
App still open at that time also quits. Development startup (`npm start`) is
not restricted so the project remains maintainable.

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
- [ ] `server/rag/` contains performance concept documents
- [ ] YOLO model downloaded: `app2-yolo/pose_landmarker_lite.task`
- [ ] `/control`, `/projection`, `/monitor` open and connected (green badge)
- [ ] Test mic: speak → transcript appears on projection within 2s
- [ ] Full manual verification: `tests/manual/`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No realtime provider available | Missing API key | Open `/control` → `系統設定`, enter and save a provider key |
| `AI 未開始` badge stays after tapping 開始 | Mic permission denied | Check browser permissions |
| Transcript never appears on projection | `/projection` not connected to bus | Refresh `/projection` page |
| `MediaPipe: model not found` | Missing `.task` file | Run `python -c "from processors.yolo_detector import _ensure_model; _ensure_model()"` in venv |
| NDI stream not visible | NDI SDK not installed | Download from ndi.video, then `pip install ndi-python` |
| Projection fullscreen toggle only hides the menu bar, doesn't resize | Fixed — uses platform-native `setFullScreen()`, not kiosk mode (kiosk had known Electron/macOS reliability bugs) | Update to latest; if still stuck, check the Electron main-process console for `[main] projection fullscreen →` log lines |
| Saving an AI character preset silently does nothing in the packaged app | Fixed — Electron does not implement `window.prompt()` at all; preset naming now uses an in-page modal | Update to latest; verify in the actual `.app`, not just a browser tab, since `window.prompt()` works fine in a regular browser but throws in Electron |
| Gemini Live disconnects every time a parameter changes | Expected, not a bug — Gemini's public Live API has no live-update mechanism at all, so any parameter change reconnects | Confirm the console shows a clean `1000` close, not `1007 Request contains an invalid argument`, which would indicate a regression |
| AI stops responding and never recovers | Fixed in lite — a Gemini provider error now always sends a matching completion signal, and a manual `開始/連線` always resets the automatic-reconnect budget | Update to latest; if it still happens, capture the Control log and server console output |
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
reconnect decision, preset CRUD, provider-catalog fetch/cache/fallback logic,
and the three connection-reliability regression fixes. Anything requiring a
live provider connection, real audio hardware, or the actual Electron app is
covered by the manual protocols in `tests/manual/` instead.

---

## Project Structure

```
ourT/
  server/                       # Node.js backend + frontend (App 1)
    index.js                    # Express + WS server
    lib/
      realtime-proxy.js         # OpenAI Realtime / Gemini Live WebSocket bridge
      realtime-session.js       # Pure session payload builders + reconnect decision (unit-tested)
      provider-catalog.js       # Voice catalogs + live OpenAI/Gemini model fetching
      settings.js                # Runtime settings + character preset persistence
      weather.js                # OpenMeteo fetch (Chiayi)
      reconnect-retry.js        # Bounded automatic-reconnect retry policy (unit-tested)
    public/
      control/index.html        # Operator control panel
      control/pcm-processor.js  # AudioWorklet (mic PCM16)
      projection/index.html     # Projection screen (AI transcript)
      monitor/index.html        # Performer stage monitor
    rag/                        # RAG context docs for the AI conversation
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
  ourT-electron/                # Electron bundle (App 1)
    main.js                     # Electron main process
    package.json                # electron-builder config
    dist/                       # Build output (.dmg, git-ignored — never bundles settings.json)
  experiments/                  # Prototypes / spikes
  tests/
    unit/                       # Automated pure-logic tests (node:test)
    manual/                     # Manual verification protocols
  start.sh                      # Dev launcher
  PLAN.md                       # Implementation plan
```
