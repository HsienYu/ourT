# App 1 — AI Realtime Chat: Manual Verification Protocol

Perform this checklist before each rehearsal and performance.
Record results and evidence in the Evidence column.

## Setup

- [ ] `server/.env` or the control-panel settings has a valid OpenAI or Gemini API key
- [ ] Node.js server started: `cd server && npm start`
- [ ] Operator panel opened on mobile/tablet: `http://[mac-ip]:3000/control`
- [ ] Projection screen opened full-screen: `http://[mac-ip]:3000/projection`
- [ ] Monitor page opened on stage monitor: `http://[mac-ip]:3000/monitor`

---

## 1. Bus Connection

| Check | Expected | Evidence |
|---|---|---|
| Open `/control` | Header shows `已連線` (green badge) | |
| Open `/projection` | Shows `待機中` then switches to AI mode | |
| Open `/monitor` | Shows `已連線` (top-right) | |

---

## 2. Session Start

| Check | Expected | Evidence |
|---|---|---|
| Tap 開始 / 連線 on control panel | Browser requests mic permission | |
| Grant mic permission | `AI 未開始` badge changes to `連線中…` | |
| Wait 2–5s | Badge changes to `◉ 通話中` (accent colour) | |
| Log shows | Selected provider connects, then session becomes active | |

---

## 3. Voice Activity Detection (VAD)

| Check | Expected | Evidence |
|---|---|---|
| Speak into mic | Monitor: MIC dot turns green, `你的回合` | |
| | Projection: small dot appears top-left (subtle) | |
| | Projection: transcript border dims | |
| Stop speaking | MIC dot fades, monitor shows `—` | |

---

## 4. AI Response Flow

| Check | Expected | Evidence |
|---|---|---|
| Speak a sentence, stop | Monitor: `AI 思考中` (yellow dot wave) | |
| | Projection: cursor switches to three-dot wave | |
| AI begins responding | Monitor: `AI 說話中…`, text scrolls | |
| | Projection: border turns accent colour, text streams | |
| | AI voice heard through speaker | |
| AI finishes | Monitor: `完成` (green, fades after 2s) | |
| | Projection: cursor returns to slow blink | |

---

## 5. Live Parameter Update

| Check | Expected | Evidence |
|---|---|---|
| Change voice (e.g. Nova → Onyx) | Tap `更新參數` | |
| Speak again | Next AI response uses new voice | |
| Change emotional state to `憤怒` | Monitor params row updates | |
| Speak again | AI response reflects angrier emotional state | |
| Check monitor params row | Shows correct emotional state and slider values | |

---

## 5a. Provider Settings

| Check | Expected | Evidence |
|---|---|---|
| Open `系統設定` in `/control` | Existing API keys remain masked | |
| Select Gemini Live, save, then start a fresh session | Gemini connects and the mic/VAD flow works | |
| Select OpenAI, save, then start a fresh session | OpenAI connects and the mic/VAD flow works | |

---

## 6. Interrupt (打斷)

| Check | Expected | Evidence |
|---|---|---|
| While AI is speaking, tap 打斷 AI | AI voice stops immediately | |
| | Projection: `— 打斷 —` appears in ai-meta | |
| | Monitor: `已打斷` state shown | |

---

## 7. Weather Integration

| Check | Expected | Evidence |
|---|---|---|
| Wait for weather fetch | Control panel weather widget shows temp/humidity | |
| Ask AI "現在嘉義幾度？" | AI references the real weather data | |

---

## 8. Disconnect / Reconnect

| Check | Expected | Evidence |
|---|---|---|
| Kill network (turn off WiFi) | Control panel bus badge changes to `斷線` | |
| | Panel shows `匯流排斷線，3 秒後重試…` | |
| Restore network | Panel reconnects within 5s | |
| If realtime session dropped | Tap 開始 / 連線 to restart | |

---

## 9. Latency Measurement

Measure end-to-end latency: performer stops speaking → AI first word audible.

| Attempt | Latency (seconds) | Notes |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |

Target: < 2s on local network. Document actual result.

---

## Pass Criteria

All checks above completed with no blocking failures. Latency documented.
