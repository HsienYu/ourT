# App 3 — KTV: Manual Verification Protocol

Perform this checklist before each rehearsal.
Record results and evidence in the Evidence column.

## Setup

- [ ] At least 2 songs in `songs/index.json` with audio (`.mp3`) and lyrics (`.lrc`)
- [ ] Node.js server running: `cd server && npm start`
- [ ] Projection screen open: `http://[mac-ip]:3000/projection`
- [ ] Operator panel open: `http://[mac-ip]:3000/control`
- [ ] Audience page open on a phone: `http://[mac-ip]:3000/audience`
- [ ] `ANTHROPIC_API_KEY` set in `.env`

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
| Tap 播放下一首 on operator panel | Projection switches to KTV mode | |
| Song title and artist shown | Large text, accent colour | |
| Audio plays | Sound audible from speaker | |
| Lyrics appear and sync | Active line highlighted, changes with music | |
| Progress bar fills | Thin bar at bottom grows left to right | |

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

## 6. Auto-Rewrite on Enqueue (`KTV_AUTO_REWRITE=true`)

| Check | Expected | Evidence |
|---|---|---|
| Set `KTV_AUTO_REWRITE=true` in `.env`, restart server | | |
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

## 8. Song Import (import-song.js)

Test with one real YouTube URL.

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
| Catalog updated | Song appears in `songs/index.json` | |
| Song available in audience page | Listed after server restart | |

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
