# App 1 — AI Realtime Chat: Manual Verification Protocol

Perform this checklist before each rehearsal and performance.
Record results and evidence in the Evidence column.

Pure-logic checks (session payload schemas, reconnect decisions, preset
CRUD, voice/model catalog correctness) are covered by automated unit tests —
see `tests/unit/README.md`. Run `node --test tests/unit/*.test.js` before
each rehearsal as well; this manual protocol covers only what requires a
live provider connection, real audio hardware, or the actual Electron app.

## Setup

- [ ] `/control` → `系統設定` has a valid OpenAI or Gemini API key and the intended audio devices selected
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

Reconnect behavior is NOT the same on both providers — confirmed by a live
incident where sending a Gemini live-update closed the WebSocket with code
1007 (`Request contains an invalid argument`), which read as a repeated
disconnect on every parameter change. Root cause: Gemini's public Live API
has no live-update mechanism at all — its entire setup message (voice, model,
AND instructions) is one-time. OpenAI only locks voice specifically.

Run this whole section **twice** — once with `realtime.provider = openai`,
once with `gemini` — since the expected behavior genuinely differs.

### OpenAI

| Check | Expected | Evidence |
|---|---|---|
| With a session active, drag a slider (e.g. 自我懷疑) without clicking `更新參數` | Within ~1s, log shows `參數已即時更新`; session stays connected the whole time (no drop in the Electron console) | |
| Change emotional state to `憤怒` without clicking `更新參數` | Monitor params row updates immediately; log shows an automatic push; session stays connected | |
| Speak again after either change above | AI response reflects the new state | |
| Type in `額外指令注入` textarea | Live update fires ~400ms after you stop typing (not on every keystroke); session stays connected | |
| Enable `精簡資訊回覆`, then ask for a label, summary, or audience observation | Without reconnecting, AI replies in 1–3 short sentences; it does not ask a question, invite a response, or continue the topic | |
| Disable `精簡資訊回覆`, then ask the same kind of question | Normal open-ended conversational behavior returns | |
| Change voice (e.g. Marin → Cedar) | Log shows `聲音已變更，需要重新連線才能套用…`; session reconnects (badge briefly drops then returns to `◉ 通話中`) | |
| Speak again after voice reconnect | New voice is audible | |
| Click `更新參數` manually | Still works as an explicit immediate push | |

### Gemini Live

| Check | Expected | Evidence |
|---|---|---|
| With a session active, drag a slider without clicking `更新參數` | Log shows `Gemini Live 無法在連線中更新設定，正在重新連線以套用變更…`; session reconnects (badge drops then returns to `◉ 通話中`) — this is expected, not a bug | |
| Watch the Electron/server console during the reconnect | `gemini WebSocket closed: 1000` (clean close from our own reconnect) — must NOT be `1007 Request contains an invalid argument` | |
| Change emotional state / attitude / prompt override | Same reconnect behavior each time | |
| Enable or disable `精簡資訊回覆` during a session | One clean reconnect occurs; after reconnection, information-style requests receive only 1–3 short sentences with no follow-up question | |
| Drag a slider back and forth quickly (multiple ticks within 400ms) | Only ONE reconnect happens (debounced), not one per tick | |
| Speak again after any reconnect | AI response reflects the new state | |
| Change voice | Same reconnect path (no different from any other parameter, since Gemini always reconnects) | |

---

## 5c. AI Character Presets

Must be tested in the actual Electron app, not just a regular browser tab —
Electron does not implement `window.prompt()` at all (throws by design), so
naming a preset uses a custom in-page modal (`#modal-overlay`) instead. A
browser-only test would not have caught the original bug.

| Check | Expected | Evidence |
|---|---|---|
| Tune voice/attitude/state/sliders, click `+ 儲存目前設定為新預設` | A custom in-page dialog appears (not a native OS prompt) asking for a name | |
| Save a preset with `精簡資訊回覆` enabled, switch it off, then reload the preset | The checkbox returns to enabled and the next AI instruction update uses concise information behavior | |
| Type a name and click `確認` | New numbered row appears in `AI 角色預設` list with that name | |
| Click `+ 儲存目前設定為新預設` again and click `取消` instead | No new preset is created | |
| Change several params away from the saved preset, then click the preset's load button | All params/voice snap back to the saved combination; live update fires (always reconnects on Gemini, or if voice differs on OpenAI) | |
| Click a preset's `儲存目前設定` button | Custom confirm dialog appears; confirming overwrites the preset with current params | |
| Click a preset's `×` button | Custom confirm dialog appears; confirming removes the row | |
| Restart the server, reopen `/control` | Previously saved presets still appear (persisted to settings.json) | |
| Save 5+ presets | List keeps growing (not capped at 4) | |

---

## 5d. Voice / Model Catalog Accuracy

| Check | Expected | Evidence |
|---|---|---|
| Open `系統設定`, look at `OpenAI Realtime 模型` dropdown | Populated from a live fetch (not a hardcoded guess); includes at least `gpt-realtime-2.1` | |
| Look at `Gemini Live 模型` / `Gemini 文字模型` dropdowns | Populated live; if empty/offline, falls back gracefully without breaking the form | |
| Look at the AI 角色 voice grid | Shows 10 OpenAI voices; `Marin` and `Cedar` are visibly marked recommended; `Fable`/`Onyx`/`Nova` are absent | |
| Switch `Realtime 語音提供者` to Gemini, open `Gemini Live 聲音` dropdown | Shows the full 30-voice catalog, not just 5 | |
| Disconnect network briefly, reopen `系統設定` | Dropdowns still show the previously saved value (no data loss), status doesn't hard-fail | |

---

## 5e. Text-Model Dropdowns and Song-Analysis Prompt Override

New model pickers for the text-generation providers (distinct from the
Realtime/Live voice models above), plus an operator-configurable override for
the KTV song-analysis system prompt.

| Check | Expected | Evidence |
|---|---|---|
| Open `系統設定`, look at `Claude 文字模型` / `Groq 文字模型` / `Mistral 文字模型` / `OpenAI 文字模型` | Each is populated (static lists), no duplicate entries in any dropdown | |
| Change one, save, reload `/control` | The saved value persists | |
| Leave `歌曲分析自訂提示` empty, trigger 他點這首歌有什麼樣的傾向？ from `/audience` | Analysis uses the original built-in prompt (still coherent, ~100 字以內) | |
| Enter a custom prompt in `歌曲分析自訂提示`, save, trigger analysis again | Analysis visibly reflects the custom prompt's instructions | |
| Clear the custom prompt, save | Analysis reverts to the built-in default | |

---

## 5f. RAG Context (Taiwan LGBT Movement History)

`server/rag/taiwan-lgbt-history.md` is now included in the Realtime AI
conversation's instructions (previously RAG only reached lyrics
rewrite/song analysis) — verify it's actually reachable and used
appropriately, not just present in the file.

| Check | Expected | Evidence |
|---|---|---|
| Start a session, ask about 台灣同志運動歷史 or 常德街事件/Corners 酒吧/AG 健身中心 | AI references the real events with roughly correct facts, not fabricated details | |
| Ask a completely unrelated question (e.g. 今天天氣如何) | AI does NOT unprompted recite the historical content — it stays contextually silent about it | |
| Ask about a historical detail NOT in the file (e.g. names of specific people involved) | AI does not fabricate specifics; acknowledges uncertainty | |
| Confirm the tone | AI treats the 1992 T Bar 偷拍/自殺 event with appropriate gravity, not casually | |

---

## 5g. Short-Term Memory Across Reconnects

Bounded (~4 exchanges) conversation memory, sent with every `session.start`
so a reconnect (Gemini parameter change, OpenAI voice change, or KTV
pause/resume — see 5h below) doesn't start the conversation cold.

| Check | Expected | Evidence |
|---|---|---|
| Have a short exchange (2-3 turns), then change an attitude/slider with Gemini active | Session reconnects (expected); once reconnected, ask "剛才我們在聊什麼？" | AI can reference the recent exchange, not just the system prompt | |
| Same test with OpenAI, but change voice (which also reconnects) | Same result — recent exchange is remembered after the voice-change reconnect | |
| With OpenAI, change a parameter that does NOT reconnect (e.g. attitude) | Conversation continues normally (no seeding needed — same live connection) | |
| Tap 結束 (`endSessionManually`), then 開始 / 連線 again | AI does NOT remember the prior conversation — memory is intentionally cleared on an explicit operator stop | |
| Have a long exchange (10+ turns), then trigger a reconnect | Only the most recent ~4 exchanges are seeded, not the entire conversation (bounded, "short" memory by design) | |

---

## 5h. KTV / AI Mutual Exclusion

While a song plays, the AI conversation should be silent — verify this is
now automatic in both directions.

| Check | Expected | Evidence |
|---|---|---|
| Start an AI session, then play a KTV song (播放 / 播放此歌 from `/control`) | AI session automatically closes (mic, output audio, and the Realtime connection all stop) — Control log shows `KTV 開始播放，AI 對話暫停` | |
| Let the song play to the end | AI session automatically reconnects — Control log shows `KTV 播放結束，AI 對話自動重新連線` | |
| While a song is playing, tap 切歌 to skip directly to another queued song | AI does NOT reconnect between the two songs — it was already disconnected and stays disconnected through the skip | |
| Skip to an empty queue (切歌 with nothing queued next) | AI reconnects once, exactly as if the first song had ended naturally | |
| Manually tap 結束 (`endSessionManually`) with no KTV involved, then play a song later | No spurious auto-reconnect happens when the song ends — the pause-tracking flag is only set by KTV-triggered disconnects, not manual ones | |

---

## 5i. Voice-Triggered Response Length (`set_response_length`)

Generalizes the `精簡資訊回覆` checkbox into something the performer can also
trigger by voice — requires `AI 對話功能開關 → 語音調整回應長度` enabled and a
session restart after enabling it (tool declarations are connect-time-only).

| Check | Expected | Evidence |
|---|---|---|
| Enable the toggle, save, restart the session | No visible error; session connects normally | |
| Mid-conversation, say something like "可以簡短一點嗎" / "不要講太久" | AI's next replies become noticeably shorter (1-3 sentences), without you touching the `精簡資訊回覆` checkbox | |
| Watch the checkbox during this | It updates to checked automatically, and the Control log shows `AI 語音要求調整回應長度：concise` | |
| On OpenAI | The change applies without any visible reconnect | |
| On Gemini | One reconnect occurs, then the shorter behavior takes effect | |
| Say "可以多說一點嗎" / "詳細一點" | AI gives longer, more detailed responses (`expanded`); checkbox unchecks (checkbox only represents concise vs not) | |
| Say something like "恢復正常" / "普通就好" | Behavior returns to normal-length responses (`normal`) | |
| Trigger the change repeatedly (concise → expanded → concise) in one session | Instructions do not visibly accumulate duplicated/conflicting rules — only the latest requested length applies | |
| Disable the toggle, restart the session, try the same voice request | AI does not call the tool at all (no tool was declared this session) | |

---

## 5j. Voice-Triggered Song Search + Import

Requires `AI 對話功能開關 → 語音搜尋並下載歌曲` enabled (default OFF) and a
session restart after enabling it. This starts real `yt-dlp`/Whisper work —
run it against real network access.

| Check | Expected | Evidence |
|---|---|---|
| With the toggle OFF, ask the AI to find a song | AI does not attempt to search (tool not available this session) | |
| Enable the toggle, restart the session, ask "幫我找一首周杰倫的稻香" | Within a few seconds, AI reads back 1-2 candidate results (title/channel) | |
| Say something ambiguous instead of confirming (e.g. change topic) | AI does NOT start downloading without a clear confirmation | |
| Confirm a specific result (e.g. "對，就是這個" / "第一個") | AI acknowledges it started downloading (~1 minute), conversation continues normally in the meantime | |
| Wait ~30-90s | AI naturally mentions the download finished, without you asking again — confirms the completion announcement arrived | |
| Check `/control`'s 控制台選歌 or `/audience` | The new song appears in the catalog | |
| Confirm it was NOT auto-queued | It does not appear in the KTV queue until an operator manually adds it | |
| Repeat a full voice-triggered import 5 times in one server run, then request a 6th | The 6th request is refused (AI relays that the limit was reached); `/control`'s manual search+import is unaffected by this cap | |
| Restart the server, try again | The cap resets — the count is per server run/performance, not persisted forever | |

---

## 5a. Provider Settings

| Check | Expected | Evidence |
|---|---|---|
| Open `系統設定` in `/control` | Existing API keys remain masked | |
| Tap `測試麥克風` with no active session | INPUT graph moves while speaking; status says `AudioWorklet 已接收麥克風 PCM 資料` | |
| Tap `測試輸出` | Two 880 Hz tones are audible from selected/system output | |
| Select Gemini Live, save, then start a fresh session | Gemini connects and the mic/VAD flow works | |
| Select OpenAI, save, then start a fresh session | OpenAI connects and the mic/VAD flow works | |
| Select intended audio input/output, save, then start a fresh session | Controls report the selected device; selection applies to the new session | |
| Speak at normal volume | INPUT meter moves and shows a non-empty dB value | |
| Wait for the AI response | OUTPUT meter moves and AI speech is audible from the selected/system output | |
| Watch the audio status line during a session | It progresses through `輸入擷取中` → `提供者已就緒` → `麥克風音訊已傳送` → `AI 音訊播放中` | |

---

## 5a-1. Microphone Access in the Packaged/Signed Electron App

The signed, hardened-runtime `.app`/`.dmg` build blocks microphone access at
the macOS level unless the `com.apple.security.device.audio-input`
entitlement is present — this is separate from, and in addition to, the
in-app `NSMicrophoneUsageDescription` permission prompt. This was root-caused
and fixed in `ourT-electron/build/entitlements.mac.plist` /
`package.json`'s `mac.entitlements`, but the actual OS permission grant and
real speech capture can only be verified by a human with physical hardware —
run this section specifically against a freshly built `.dmg`, not `npm start`
dev mode (dev mode is unsigned and was never actually affected by this bug).

| Check | Expected | Evidence |
|---|---|---|
| Verify the entitlement is embedded: `codesign -d --entitlements - ourT.app` | Output includes `com.apple.security.device.audio-input` = true | |
| Install/open a freshly built `.dmg` for the first time on this Mac | macOS shows the microphone permission dialog with the Traditional Chinese description `ourT 需要使用麥克風以擷取演員語音，並即時傳送給 AI 語音服務。` | |
| Click 允許 (Allow) | Dialog dismisses; System Settings → Privacy & Security → Microphone shows ourT as granted | |
| Tap `測試麥克風` in `/control` → `系統設定` | INPUT graph actually moves while speaking (not stuck flat/empty) | |
| Tap `測試輸出` | Two 880 Hz tones audible — this does NOT require any entitlement, so if it was also failing before, confirm it's independently fixed/working now, or report the exact error if not | |
| Start a real session and speak | Transcript appears on `/monitor` and `/projection` within ~2s | |
| If macOS still silently denies mic access | Reset the permission decision: `tccutil reset Microphone com.ourt.performance`, then relaunch and grant again | |

---

## 5b. Transcript Roles, Locale, and Projection

| Check | Expected | Evidence |
|---|---|---|
| Speak a Taiwan Mandarin sentence | Monitor and Projection show an `演員` turn in 臺灣繁體中文 | |
| Wait for the AI response | Monitor and Projection show a separately labelled `AI` turn in 臺灣繁體中文 | |
| Speak terms with regional variants, such as `軟體` or `腳踏車` | Display uses 臺灣慣用字詞; no Simplified Chinese appears | |
| Send enough turns to exceed the visible Projection area | Projection transcript automatically follows the newest turn | |
| Tap the Control `投影全螢幕` button | Electron Projection window enters/exits fullscreen on each tap | |

---

## 6. Interrupt (打斷) — Manual and Voice Barge-in

Run this whole section once with `realtime.provider = openai` and once with
`gemini` — the interrupt path must behave identically on both.

| Check | Expected | Evidence |
|---|---|---|
| While AI is speaking, tap 打斷 AI | AI voice stops **instantly** (not after a few more seconds of already-buffered audio) | |
| | Projection: `— 打斷 —` appears in ai-meta | |
| | Monitor: `已打斷` state shown | |
| | Control log shows `AI 已被打斷` | |
| While AI is speaking, interrupt by speaking over it (voice barge-in, no button) | AI voice stops within roughly one VAD detection window, without touching any button | |
| | Projection/Monitor show the same `— 打斷 —` / `已打斷` cue as the manual button | |
| After voice-interrupting, ask about a different topic | AI responds to the new topic, not the interrupted one — confirms the turn genuinely handed back to the performer | |
| Tap 打斷 AI when the AI is NOT currently speaking | No spurious `— 打斷 —` cue appears (server only broadcasts the cue when a response was actually in progress); log shows `沒有進行中的 session 可打斷` if no session, or no visible effect if session is idle | |

---

## 6a. Electron Fullscreen and Window Layout

Uses the platform-native `setFullScreen()` (macOS native fullscreen Space /
Windows OS fullscreen), not kiosk mode — kiosk mode was tried first but is a
known unreliable Electron/macOS combination (electron/electron#35684,
#38261, #1054: dock/menu bar hide and the actual fullscreen resize don't
consistently happen together). setFullScreen() is what every other
full-screen macOS/Windows app uses.

| Check | Expected | Evidence |
|---|---|---|
| Launch the Electron app fresh | Control window opens at position (60, 60), not centered/cascaded | |
| Click `切換投影全螢幕` in Control | Projection window actually resizes to fill the screen (not just menu bar hidden) — macOS: native fullscreen Space transition; Windows: covers the taskbar | |
| Click it again | Projection window returns to its previous windowed size/position | |
| Toggle from the tray menu (`切換投影全螢幕`) instead of Control | Same fullscreen toggle behavior | |
| Watch the Electron main process console during both toggles | Shows `[main] projection fullscreen → true` / `→ false`; no `Uncaught Exception` | |

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
