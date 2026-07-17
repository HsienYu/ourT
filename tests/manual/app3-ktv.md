# App 3 — KTV: Manual Verification Protocol

Perform this checklist before each rehearsal.
Record results and evidence in the Evidence column.

## Setup

- [ ] At least 2 songs in `songs/index.json` with audio (`.mp3`) and lyrics (`.lrc`)
- [ ] Node.js server running: `cd server && npm start`
- [ ] Projection screen open: `http://[mac-ip]:3000/projection`
- [ ] Operator panel open: `http://[mac-ip]:3000/control`
- [ ] Audience page open on a phone: `http://[mac-ip]:3000/audience`
- [ ] A text-generation provider key is configured in `/control` → `系統設定`

---

## 1. Song Catalog

| Check | Expected | Evidence |
|---|---|---|
| Open audience page | Songs listed with title and artist | |
| Search for a song | Filtered results appear | |
| Song cover image | Appears (or gracefully absent) | |

---

## 2. Song Request Flow

| Check | Expected | Evidence |
|---|---|---|
| Tap 點歌 for a song on phone | Toast: 已加入：[title] | |
| Queue updates on operator panel | Song appears in KTV 點歌佇列 | |
| Tap 播放 on operator panel | Projection switches to KTV mode | |
| Song title and artist shown | Large text, accent colour | |
| Audio plays | Sound audible from speaker | |
| Lyrics appear and sync | Active line highlighted, changes with music | |
| Progress bar fills | Thin bar at bottom grows left to right | |
| With another request queued, tap 切歌 | Current audio stops and the next song immediately starts on projection | |
| Tap 切歌 with no next request | Current audio stops, projection leaves KTV mode, and queue shows no current song | |

---

## 3. Cover Art Background

| Check | Expected | Evidence |
|---|---|---|
| Song with cover art plays | Blurred, dark cover art behind lyrics | |
| Song without cover art plays | Plain dark background — no error | |

---

## 4. Lyric Wipe Mode

| Check | Expected | Evidence |
|---|---|---|
| Default mode (整行) | Active line highlights as a whole | |
| Tap 歌詞模式：整行 button | Switches to 歌詞模式：掃光 | |
| Wipe mode | Active line colour sweeps left to right with music | |
| Switch back to 整行 | Highlights return to whole-line mode | |

---

## 5. LLM Lyrics Rewrite (On-Demand)

| Check | Expected | Evidence |
|---|---|---|
| Open Lyrics Editor in operator panel | Song selector populated | |
| Select a song | Variant buttons show which variants exist | |
| Tap LLM 即時生成 (gender-swap) | Status shows 生成中… then 已生成：gender-swap 已推送到投影 | |
| If song is currently playing | Lyrics hot-swap on projection without audio interruption | |
| Wipe colour changes | gender-swap → cool blue (rather than default pink) | |
| Tap 清除覆蓋 | Lyrics revert to original | |

---

## 6. Auto-Rewrite on Enqueue

| Check | Expected | Evidence |
|---|---|---|
| Enable KTV 自動改寫 in `/control` → `系統設定` | | |
| Request a song from audience phone | Server log: `[lyrics] Generated variant 'gender-swap' for song '…'` | |
| Tap 播放下一首 | Modified lyrics already loaded; no delay | |
| If generation still in progress when song starts | Original lyrics shown first, then auto-swap when ready | |

---

## 7. AI Analysis

| Check | Expected | Evidence |
|---|---|---|
| While song plays, tap 他點這首歌有什麼樣的傾向？ on operator panel | Analysis overlay appears on projection | |
| Claude analysis text | Relevant, in zh-TW, 100 words or fewer | |
| Trigger from audience phone | Same overlay appears | |
| Tap 關閉 on overlay | Overlay disappears, KTV resumes | |

---

## 8. Song Import — CLI (import-song.js)

Test with one real YouTube URL. `import-song.js` is now a thin wrapper around
`lib/song-importer.js` — the same pipeline the search/import UI (Section 8a)
uses, so this also validates that shared code path.

```bash
cd server
node scripts/import-song.js \
  --url "https://youtube.com/watch?v=..." \
  --title "測試歌曲" \
  --artist "測試藝人" \
  --tags "測試"
```

| Check | Expected | Evidence |
|---|---|---|
| Audio downloaded | `songs/audio/<id>.mp3` exists | |
| LRC generated | `songs/lyrics/<id>.lrc` exists with timestamps | |
| Console shows transcription method | `已透過 OpenAI Whisper API 轉錄（含逐字時間戳記）` if an OpenAI key is configured, or `已透過本機 whisper 轉錄` otherwise | |
| Catalog updated | Song appears in `songs/index.json` | |
| Song available in audience page | Listed without server restart or page reload | |

---

## 8a. Song Search + Import UI (/control)

New in this phase — no YouTube API key required, uses `yt-dlp`'s built-in
search (`ytsearch:`).

| Check | Expected | Evidence |
|---|---|---|
| Open `/control`, type a song name in 搜尋並匯入歌曲, tap 搜尋 | Within a few seconds, up to 6 results appear with thumbnail/title/channel/duration | |
| Search for something with zero results (e.g. gibberish) | Status shows `沒有找到結果`, no error thrown | |
| Tap 匯入 on a result | Two custom dialogs prompt for 演出者 then 歌曲標題 (not native browser dialogs — this must work in the actual Electron app, not just a browser tab) | |
| Cancel either prompt | Import does not start | |
| Confirm both prompts | Button shows `匯入中…`, status line shows progress messages (下載音訊中… → 轉錄歌詞中… → 已加入歌曲目錄) | |
| Wait for completion | Button shows `✓ 已匯入`, status shows `完成` | |
| Wait for completion while `/audience` and the KTV Lyrics Editor are open | Newly imported song appears in both places without a page reload | |
| Trigger a yt-dlp failure (e.g. search for a private/deleted video's ID) | Status shows the actual error message, button re-enables as `重試匯入` | |

---

## 8b. Live Lyric Offset Tuning (歌詞偏移)

New in this phase — lets an operator fine-tune sync during rehearsal without
re-importing the song.

| Check | Expected | Evidence |
|---|---|---|
| Play a song | `歌詞偏移` slider appears in the KTV section, defaulting to the song's saved offset (usually `0 ms`) | |
| Drag the slider to +500 ms | Value label updates immediately; after ~300ms debounce, log shows `歌詞偏移已更新：500 ms` | |
| Watch the projection screen while dragging | Lyrics visibly shift later on the timeline (delay) | |
| Drag to a negative value (e.g. -300 ms) | Lyrics shift earlier | |
| Switch to a different song mid-queue | Slider resets to that song's own saved offset, not the previous song's value | |
| Restart the server, replay the same song | Slider still shows the previously saved offset — confirms it persisted to `songs/index.json` | |

---

## 9. Mode Switching

| Check | Expected | Evidence |
|---|---|---|
| During KTV, switch mode to AI on operator panel | Projection crossfades to AI transcript view | |
| Ask AI a question | AI responds on projection, KTV audio stops | |
| Switch back to KTV | Previous song continues if `ktv.play` is re-sent | |

---

## Pass Criteria

All checks above completed with no blocking failures.
LLM rewrite produces valid LRC. Lyrics hot-swap during playback works.
