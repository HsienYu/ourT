"""
main.py — App 2: YOLO Camera Server (headless / web mode)

FastAPI server at port 3001. Uses the shared Pipeline class from pipeline.py.

  GET  /          → redirect to /panel
   GET  /panel     → operator mini-panel
  GET  /preview   → MJPEG live annotated stream
  GET  /api/state        → current config + latest detection metadata
   POST /api/config       → update output settings at runtime
  GET  /api/detections   → latest detection results as JSON

Run (headless web server):
  cd app2-yolo
  source venv/bin/activate
  python main.py

Run (standalone GUI):
  python app.py
"""

from __future__ import annotations
import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict

# ── Suppress noisy C++ / framework logs before any imports ───────────────────
os.environ.setdefault("GLOG_minloglevel", "3")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("YOLO_VERBOSE", "False")

import cv2
import numpy as np
import yaml
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
import uvicorn

from pipeline import Pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logging.getLogger("ultralytics").setLevel(logging.ERROR)
log = logging.getLogger("main")

# ── Load config ───────────────────────────────────────────────────────────────
# Path.cwd() works in both contexts:
#   - bundle: app.py calls os.chdir(Resources/) before importing this module
#   - dev:    user runs from project root (same assumption as __file__.parent)
CONFIG_PATH = Path.cwd() / "config.yaml"

def load_config() -> dict:
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return yaml.safe_load(f)

cfg = load_config()

# ── Shared pipeline instance ──────────────────────────────────────────────────
pipeline = Pipeline(cfg)

# ── FastAPI ───────────────────────────────────────────────────────────────────
app = FastAPI(title="ourT YOLO Camera")

@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/panel")

# ── MJPEG stream ──────────────────────────────────────────────────────────────
async def mjpeg_generator():
    quality = cfg.get("output", {}).get("mjpeg_quality", 75)
    while True:
        snap = pipeline.snapshot()
        frame = snap.frame

        if frame is None:
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(blank, "等待畫面...", (180, 240),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (80, 80, 80), 2)
            frame = blank

        ret, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ret:
            yield (b"--frame\r\n"
                   b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")
        await asyncio.sleep(1 / 30)

@app.get("/preview")
def preview():
    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )

# ── REST API ──────────────────────────────────────────────────────────────────
@app.get("/api/state")
def api_state():
    snap = pipeline.snapshot()
    return {
        "running": snap.running,
        "fps": snap.fps,
        "detection_count": len(snap.detections),
        "error": snap.error,
    }

@app.get("/api/detections")
def api_detections():
    snap = pipeline.snapshot()
    return {
        "fps": snap.fps,
        "detections": [
            {
                "id": d.track_id,
                "bbox": list(d.bbox),
                "label": d.label,
            }
            for d in snap.detections
        ],
    }

@app.post("/api/config")
async def api_config(body: Dict[str, Any]):
    pipeline.update_config(body)
    return {"ok": True}

# ── Operator mini-panel ───────────────────────────────────────────────────────
PANEL_HTML = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>ourT — YOLO Panel</title>
<style>
  :root { --bg:#0a0a0a; --panel:#111; --border:#222; --text:#ddd; --muted:#555; --accent:#e0d0ff; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:'Courier New',monospace; font-size:13px; }
  header { padding:10px 16px; border-bottom:1px solid var(--border); background:var(--panel);
           display:flex; justify-content:space-between; align-items:center; }
  header h1 { font-size:11px; letter-spacing:3px; color:var(--muted); text-transform:uppercase; }
  .status { font-size:10px; letter-spacing:1px; }
  .page { padding:14px; display:flex; flex-direction:column; gap:18px; }
  .section-title { font-size:9px; letter-spacing:3px; color:var(--muted); text-transform:uppercase;
                   padding-bottom:6px; border-bottom:1px solid var(--border); margin-bottom:8px; }
  .preview-wrap { border:1px solid var(--border); overflow:hidden; }
  .preview-wrap img { width:100%; display:block; }
  .det-list { display:flex; flex-direction:column; gap:5px; font-size:11px; }
  .det-item { padding:6px 10px; border:1px solid var(--border); color:var(--accent); }
</style>
</head>
<body>
<header>
  <h1>YOLO Panel</h1>
  <span class="status" id="status">連線中⋯</span>
</header>
<div class="page">
  <div>
    <div class="section-title">即時畫面 / Live Preview</div>
    <div class="preview-wrap"><img id="preview" src="/preview" alt="preview"></div>
  </div>
  <div>
    <div class="section-title">即時偵測 / Live Detections</div>
    <div class="det-list" id="det-list"><div style="color:var(--muted);font-size:11px">等待中⋯</div></div>
  </div>
</div>
<script>
async function poll() {
  try {
    const s = await (await fetch('/api/state')).json();
    document.getElementById('status').textContent =
      s.running ? `fps:${s.fps}  n:${s.detection_count}` : (s.error || '未執行');
    const d = await (await fetch('/api/detections')).json();
    const el = document.getElementById('det-list');
    el.innerHTML = d.detections.length
       ? d.detections.map(p => `<div class="det-item">標籤:${p.label}</div>`).join('')
      : '<div style="color:var(--muted);font-size:11px">無人在框內</div>';
  } catch(e) {}
}
setInterval(poll, 1000); poll();
</script>
</body>
</html>"""

@app.get("/panel", response_class=HTMLResponse)
def panel():
    return PANEL_HTML

# ── Startup / Shutdown ────────────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    pipeline.start()
    log.info("[server] Pipeline started")

@app.on_event("shutdown")
def shutdown():
    pipeline.stop()

if __name__ == "__main__":
    server_cfg = cfg.get("server", {})
    uvicorn.run(
        "main:app",
        host=server_cfg.get("host", "0.0.0.0"),
        port=server_cfg.get("port", 3001),
        reload=False,
        log_level="info",
    )
