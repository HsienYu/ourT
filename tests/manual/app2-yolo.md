# App 2 — YOLO Camera: Manual Verification Protocol

Perform this checklist before each rehearsal.
Record results and evidence in the Evidence column.

## Setup

- [ ] Python venv activated: `cd app2-yolo && source venv/bin/activate`
- [ ] App started: `python app.py` (GUI) or `python main.py` (headless)
- [ ] Camera connected (USB or NDI source available)
- [ ] YOLO mini-panel opened: `http://[mac-ip]:3001/panel`

---

## 1. Camera Feed

| Check | Expected | Evidence |
|---|---|---|
| GUI window opens | Camera selector shows at least Camera 0 | |
| Camera feed visible in left panel | Live annotated video, no freeze | |
| `/preview` URL in browser | MJPEG feed loads and updates | |
| Frame rate displayed | fps ≥ 20 with no people in frame | |

---

## 2. Person Detection

| Check | Expected | Evidence |
|---|---|---|
| Stand in front of camera | Bounding box appears within 1s | |
| Box has zh-TW label block | Shows: gender label, score, 高/中/矮, clothing colour | |
| | Shows: posture, 職業投射, 膚色:不判定 | |
| Detection list in sidebar | Shows #ID, score, label per person | |
| 3 people in frame simultaneously | All detected, fps ≥ 15 | |
| Person leaves frame | Box disappears within 1s | |

---

## 3. Gender Heuristics

| Check | Expected | Evidence |
|---|---|---|
| Person with wide shoulders, dark clothes | Score < 50, likely 男性化 or 中性 | |
| Person with pink/red top | Score pushed toward 女性化 | |
| Bias slider to −50 | All labels → 男性化 | |
| Bias slider to +50 | All labels → 女性化 | |
| Bias slider to 0 | Labels return to heuristic-based values | |

---

## 4. Instability Modes

| Check | Expected | Evidence |
|---|---|---|
| Enable 震盪模式 | Bias drifts sinusoidally over ~30s, labels shift | |
| Enable 隨機擾動 | Each person's label jitters per frame | |
| Combine both | Labels visibly unstable, artistic effect active | |
| Disable both | Labels stabilise to normal heuristics | |

---

## 5. Custom Labels

| Check | Expected | Evidence |
|---|---|---|
| Change 男性化 text to 力量 | All masculine-coded persons show 力量 on box | |
| Change 不確定性 text to 光譜中間 | Uncertain persons show new label | |
| Labels persist across detection cycles | No revert after 10 seconds | |

---

## 6. NDI Output (if NDI SDK installed)

| Check | Expected | Evidence |
|---|---|---|
| Toggle NDI Output ON in GUI | No crash, log shows NDI started | |
| Open NDI Monitor or Resolume | Stream `ourT-YOLO` visible | |
| Annotated labels appear in NDI stream | Same as GUI feed | |

---

## 7. Performance Under Load

Run this with 3+ people in frame for 10 minutes.

| Metric | Target | Measured | Notes |
|---|---|---|---|
| Frame rate | ≥ 15 fps | | |
| CPU usage | < 80% | | |
| Memory | Stable (no growth) | | |
| Crashes | None | | |

---

## Pass Criteria

All checks above completed. Frame rate ≥ 15fps with 3 people in frame. No crashes.
