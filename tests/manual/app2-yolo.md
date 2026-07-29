# App 2 — YOLO Camera: Manual Verification Protocol

Perform this checklist before each rehearsal. Record results and evidence in
the Evidence column.

## Setup

- [ ] Python venv activated: `cd app2-yolo && source venv/bin/activate`
- [ ] App started: `python app.py` (GUI) or `python main.py` (headless)
- [ ] Camera connected (USB or NDI source available)
- [ ] YOLO mini-panel opened: `http://[mac-ip]:3001/panel`

## 1. Camera Feed

| Check | Expected | Evidence |
|---|---|---|
| GUI window opens | Camera selector shows at least Camera 0 | |
| Camera feed visible in left panel | Live annotated video, no freeze | |
| `/preview` URL in browser | MJPEG feed loads and updates | |
| Frame rate displayed | fps >= 20 with no people in frame | |

## 2. YAML Label Assignment

| Check | Expected | Evidence |
|---|---|---|
| Stand in front of camera | Bounding box appears within 1s | |
| Box annotation | Shows only `標籤:<YAML label>` | |
| GUI sidebar and web panel | Show only `標籤:<YAML label>` per person | |
| Remain in frame for 10 seconds | The tracker keeps the same label | |
| Leave and re-enter frame | A newly created track may receive a different YAML label | |
| Three people in frame simultaneously | All detected, each shows one label, fps >= 15 | |
| Check label source | Displayed labels are present in `config.yaml` under `labels` | |

## 3. NDI Output (if NDI SDK installed)

| Check | Expected | Evidence |
|---|---|---|
| Toggle NDI Output ON in GUI | No crash, log shows NDI started | |
| Open NDI Monitor or Resolume | Stream `ourT-YOLO` visible | |
| Annotated labels appear in NDI stream | Same `標籤` annotation as GUI feed | |

## 4. Performance Under Load

Run this with 3+ people in frame for 10 minutes.

| Metric | Target | Measured | Notes |
|---|---|---|---|
| Frame rate | >= 15 fps | | |
| CPU usage | < 80% | | |
| Memory | Stable (no growth) | | |
| Crashes | None | | |

## Pass Criteria

All checks above completed. Frame rate >= 15fps with 3 people in frame. No
crashes.
