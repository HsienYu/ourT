"""
main.py — App 2: YOLO Camera Server (headless / web mode)

FastAPI server at port 3001. Uses the shared Pipeline class from pipeline.py.

  GET  /          → redirect to /panel
  GET  /panel     → operator mini-panel (bias, labels, toggles)
  GET  /preview   → MJPEG live annotated stream
  GET  /api/state        → current config + latest detection metadata
  POST /api/config       → update heuristics / labels / colors at runtime
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
from typing import Any, Dict, Optional

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
CONFIG_PATH = Path(__file__).parent / "config.yaml"

def load_config() -> dict:
    with open(CONFIG_PATH) as f:
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
        "heuristics": snap.heuristics_cfg,
        "labels": snap.labels_cfg,
        "colors": snap.colors_cfg,
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
                "score": d.score,
                "raw_score": d.raw_score,
                "label": d.label,
                "shoulder_hip_ratio": d.shoulder_hip_ratio,
                "height": d.height,
                "clothing_colour": d.clothing_colour,
                "image_light": d.image_light,
                "skin_tone": d.skin_tone,
                "posture": d.posture,
                "role_projection": d.role_projection,
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
  :root {
    --bg:#0a0a0a; --panel:#111; --border:#222; --text:#ddd; --muted:#555;
    --masc:#5064ff; --fem:#ff6480; --neutral:#80ff80; --fluid:#ffdc64;
    --accent:#e0d0ff;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:'Courier New',monospace; font-size:13px; }
  header { padding:10px 16px; border-bottom:1px solid var(--border); background:var(--panel);
           display:flex; justify-content:space-between; align-items:center; }
  header h1 { font-size:11px; letter-spacing:3px; color:var(--muted); text-transform:uppercase; }
  .status { font-size:10px; letter-spacing:1px; }
  .page { padding:14px; display:flex; flex-direction:column; gap:18px; }
  .section-title { font-size:9px; letter-spacing:3px; color:var(--muted); text-transform:uppercase;
                   padding-bottom:6px; border-bottom:1px solid var(--border); margin-bottom:8px; }
  .param { display:flex; flex-direction:column; gap:5px; margin-bottom:10px; }
  .param-header { display:flex; justify-content:space-between; }
  .param-label { font-size:11px; }
  .param-label span { font-size:9px; color:var(--muted); display:block; }
  .param-value { font-size:11px; color:var(--accent); min-width:24px; text-align:right; }
  input[type=range] { -webkit-appearance:none; width:100%; height:2px; background:var(--border); outline:none; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px;
    background:var(--accent); border-radius:50%; cursor:pointer; }
  .toggle-row { display:flex; gap:8px; }
  .toggle-btn { flex:1; padding:9px; border:1px solid var(--border); background:transparent;
    color:var(--muted); font-family:monospace; font-size:10px; cursor:pointer;
    text-transform:uppercase; letter-spacing:1px; transition:all 0.15s; }
  .toggle-btn.on { border-color:var(--accent); color:var(--accent); background:rgba(224,208,255,0.07); }
  .preview-wrap { border:1px solid var(--border); overflow:hidden; }
  .preview-wrap img { width:100%; display:block; }
  .det-list { display:flex; flex-direction:column; gap:5px; font-size:11px; }
  .det-item { padding:6px 10px; border:1px solid var(--border); display:flex;
    justify-content:space-between; align-items:center; }
  .det-item .tag { font-size:10px; padding:1px 6px; border:1px solid currentColor; }
  .tag-masc    { color:var(--masc); } .tag-fem  { color:var(--fem); }
  .tag-neutral { color:var(--neutral); } .tag-fluid { color:var(--fluid); }
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
    <div class="section-title">標籤偏移 / Classification Bias</div>
    <div class="param">
      <div class="param-header">
        <div class="param-label">偏向男性化 ←→ 偏向女性化<span>Global Bias</span></div>
        <div class="param-value" id="v-bias">0</div>
      </div>
      <input type="range" min="-50" max="50" value="0" id="s-bias" oninput="updateBias(this.value)">
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-top:3px;">
        <span>← 男性化</span><span>中性</span><span>女性化 →</span>
      </div>
    </div>
    <div class="toggle-row">
      <button class="toggle-btn" id="btn-osc"  onclick="toggleOscillation()">震盪模式 OFF</button>
      <button class="toggle-btn" id="btn-rand" onclick="toggleRandom()">隨機擾動 OFF</button>
    </div>
  </div>
  <div>
    <div class="section-title">標籤文字 / Label Text</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div><div style="font-size:9px;color:var(--muted);margin-bottom:4px">男性化</div>
        <input id="l-masc"    type="text" value="男性化" oninput="pushLabels()"
          style="width:100%;background:#000;border:1px solid var(--border);color:var(--text);font-family:monospace;font-size:12px;padding:6px 8px;outline:none;"></div>
      <div><div style="font-size:9px;color:var(--muted);margin-bottom:4px">女性化</div>
        <input id="l-fem"     type="text" value="女性化" oninput="pushLabels()"
          style="width:100%;background:#000;border:1px solid var(--border);color:var(--text);font-family:monospace;font-size:12px;padding:6px 8px;outline:none;"></div>
      <div><div style="font-size:9px;color:var(--muted);margin-bottom:4px">中性</div>
        <input id="l-neutral" type="text" value="中性"   oninput="pushLabels()"
          style="width:100%;background:#000;border:1px solid var(--border);color:var(--text);font-family:monospace;font-size:12px;padding:6px 8px;outline:none;"></div>
      <div><div style="font-size:9px;color:var(--muted);margin-bottom:4px">不確定性</div>
        <input id="l-fluid"   type="text" value="不確定性" oninput="pushLabels()"
          style="width:100%;background:#000;border:1px solid var(--border);color:var(--text);font-family:monospace;font-size:12px;padding:6px 8px;outline:none;"></div>
    </div>
  </div>
  <div>
    <div class="section-title">即時偵測 / Live Detections</div>
    <div class="det-list" id="det-list"><div style="color:var(--muted);font-size:11px">等待中⋯</div></div>
  </div>
</div>
<script>
let oscillation = false, randomize = false;
async function updateBias(val) {
  document.getElementById('v-bias').textContent = val;
  await post({ heuristics: { bias: parseInt(val) } });
}
async function toggleOscillation() {
  oscillation = !oscillation;
  const b = document.getElementById('btn-osc');
  b.textContent = '震盪模式 ' + (oscillation ? 'ON' : 'OFF');
  b.className = 'toggle-btn' + (oscillation ? ' on' : '');
  await post({ heuristics: { oscillation } });
}
async function toggleRandom() {
  randomize = !randomize;
  const b = document.getElementById('btn-rand');
  b.textContent = '隨機擾動 ' + (randomize ? 'ON' : 'OFF');
  b.className = 'toggle-btn' + (randomize ? ' on' : '');
  await post({ heuristics: { randomize } });
}
async function pushLabels() {
  await post({ labels: {
    masc: document.getElementById('l-masc').value,
    fem:  document.getElementById('l-fem').value,
    neutral: document.getElementById('l-neutral').value,
    fluid:   document.getElementById('l-fluid').value,
  }});
}
async function post(body) {
  await fetch('/api/config', { method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
}
const tagClass = {'男性化':'tag-masc','女性化':'tag-fem','中性':'tag-neutral','不確定性':'tag-fluid'};
async function poll() {
  try {
    const s = await (await fetch('/api/state')).json();
    document.getElementById('status').textContent =
      s.running ? `fps:${s.fps}  n:${s.detection_count}` : (s.error || '未執行');
    const d = await (await fetch('/api/detections')).json();
    const el = document.getElementById('det-list');
    el.innerHTML = d.detections.length
      ? d.detections.map(p =>
          `<div class="det-item"><span>ID ${p.id??'?'}  ${p.score}<br>
           高:${p.height}　服裝:${p.clothing_colour}　姿態:${p.posture}<br>
           職業投射:${p.role_projection}　膚色:${p.skin_tone}　光線:${p.image_light}</span>
           <span class="tag ${tagClass[p.label]||''}">${p.label}</span></div>`).join('')
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
