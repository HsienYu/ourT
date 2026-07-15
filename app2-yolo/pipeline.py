"""
pipeline.py

Shared detection pipeline.  Runs in a background thread.
Used by both:
  - app.py   (PyQt6 standalone GUI)
  - main.py  (FastAPI web server)

The pipeline reads frames from a CameraSource, runs YOLOv8 + MediaPipe Pose,
scores gender expression with GenderHeuristics, annotates the frame, and
optionally sends to NDI / Syphon outputs.

All mutable state is protected by a threading.Lock.
Consumers read state via snapshot() or subscribe to on_frame callbacks.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

import cv2
import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFont

from processors.camera_source import CameraSource
from processors.yolo_detector import YoloDetector
from processors.gender_heuristics import GenderHeuristics, GenderScore

log = logging.getLogger(__name__)


# ── Public data types ─────────────────────────────────────────────────────────

@dataclass
class DetectionResult:
    track_id: Optional[int]
    bbox: tuple           # x1, y1, x2, y2
    score: float
    raw_score: float
    label: str
    shoulder_hip_ratio: Optional[float]
    height: str
    clothing_colour: str
    image_light: str
    skin_tone: str
    posture: str
    role_projection: str


@dataclass
class PipelineSnapshot:
    running: bool
    fps: float
    error: Optional[str]
    detections: List[DetectionResult]
    frame: Optional[np.ndarray]      # latest annotated BGR frame (may be None)
    heuristics_cfg: dict
    labels_cfg: dict
    colors_cfg: dict


# ── Pipeline ──────────────────────────────────────────────────────────────────

class Pipeline:
    """
    Create once, call start(), subscribe to on_frame, call stop() when done.
    Config can be patched live via update_config().
    """

    def __init__(self, cfg: dict):
        self._cfg = cfg
        self._lock = threading.Lock()

        # Mutable runtime config (operator can update live)
        self._heuristics_cfg: dict = dict(cfg.get("heuristics", {}))
        self._labels_cfg: dict     = dict(cfg.get("labels", {}))
        self._colors_cfg: dict     = dict(cfg.get("colors", {}))
        self._output_cfg: dict     = dict(cfg.get("output", {}))

        # Runtime state
        self._running = False
        self._fps = 0.0
        self._error: Optional[str] = None
        self._detections: List[DetectionResult] = []
        self._latest_frame: Optional[np.ndarray] = None

        # Optional frame callback (GUI subscribes here)
        self._frame_callbacks: List[Callable[[np.ndarray, List[DetectionResult]], None]] = []

        self._thread: Optional[threading.Thread] = None

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="pipeline")
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=4)

    def on_frame(self, cb: Callable[[np.ndarray, List[DetectionResult]], None]) -> None:
        """Register a callback called after each annotated frame is ready."""
        self._frame_callbacks.append(cb)

    def update_config(self, patch: dict) -> None:
        """
        Live-update heuristics / labels / colors / output config.
        patch keys: 'heuristics', 'labels', 'colors', 'output'
        """
        with self._lock:
            if "heuristics" in patch:
                self._heuristics_cfg.update(patch["heuristics"])
            if "labels" in patch:
                self._labels_cfg.update(patch["labels"])
            if "colors"  in patch:
                self._colors_cfg.update(patch["colors"])
            if "output"  in patch:
                self._output_cfg.update(patch["output"])
                # NDI / Syphon on-off handled inside loop via flags

    def snapshot(self) -> PipelineSnapshot:
        with self._lock:
            return PipelineSnapshot(
                running=self._running,
                fps=round(self._fps, 1),
                error=self._error,
                detections=list(self._detections),
                frame=self._latest_frame.copy() if self._latest_frame is not None else None,
                heuristics_cfg=dict(self._heuristics_cfg),
                labels_cfg=dict(self._labels_cfg),
                colors_cfg=dict(self._colors_cfg),
            )

    # ── Camera source list (for GUI selector) ─────────────────────────────────

    @staticmethod
    def list_cameras(max_check: int = 6) -> List[dict]:
        """
        Probe webcam indices 0..max_check-1.
        Returns list of { index, name } for available cameras.
        OpenCV probe errors are suppressed (they are expected for missing indices).
        """
        cameras = []
        # Suppress OpenCV's own error output during probing
        os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
        for i in range(max_check):
            cap = cv2.VideoCapture(i)
            if cap.isOpened():
                # Try to get a real name on macOS via AVFoundation backend
                cameras.append({"index": i, "name": f"Camera {i}"})
                cap.release()
        return cameras

    # ── Internal pipeline loop ────────────────────────────────────────────────

    def _loop(self) -> None:
        camera_cfg  = self._cfg.get("camera", {})
        yolo_cfg    = self._cfg.get("yolo", {})

        camera: Optional[CameraSource] = None
        detector: Optional[YoloDetector] = None
        ndi_out  = None
        syph_out = None

        try:
            camera = CameraSource.from_config(camera_cfg)
            camera.start()
            log.info(f"[pipeline] Camera started: {camera.name}")

            detector = YoloDetector(
                model_name=yolo_cfg.get("model", "yolov8n.pt"),
                confidence=yolo_cfg.get("confidence", 0.45),
                device=yolo_cfg.get("device", ""),
            )

            frame_times: List[float] = []
            heuristics = GenderHeuristics({
                **self._heuristics_cfg,
                "labels": self._labels_cfg,
            })

            while self._running:
                t0 = time.time()
                raw = camera.read()
                if raw is None:
                    time.sleep(0.02)
                    continue

                # Snapshot current config (operator may update between frames)
                with self._lock:
                    h_cfg = {**self._heuristics_cfg, "labels": self._labels_cfg}
                    c_cfg = dict(self._colors_cfg)
                    out_cfg = dict(self._output_cfg)

                # Start or stop VJ outputs immediately when the GUI toggles them.
                ndi_out = self._sync_ndi_output(ndi_out, out_cfg)
                syph_out = self._sync_syphon_output(syph_out, out_cfg)

                heuristics.update_config(h_cfg)
                persons    = detector.detect(raw)

                annotated = raw.copy()
                results: List[DetectionResult] = []

                for p in persons:
                    score: GenderScore = heuristics.score(p)
                    color = _label_color(score.label, c_cfg)
                    social = heuristics.social_labels(p, raw.shape[0])
                    _draw_person(annotated, p.bbox, score, social, color)

                    results.append(DetectionResult(
                        track_id=p.track_id,
                        bbox=p.bbox,
                        score=score.final,
                        raw_score=score.raw,
                        label=score.label,
                        shoulder_hip_ratio=score.shoulder_hip_ratio,
                        height=social["height"],
                        clothing_colour=social["clothing_colour"],
                        image_light=social["image_light"],
                        skin_tone=social["skin_tone"],
                        posture=social["posture"],
                        role_projection=social["role_projection"],
                    ))

                # FPS overlay
                frame_times.append(t0)
                frame_times = [t for t in frame_times if t > t0 - 2]
                fps = len(frame_times) / 2.0
                cv2.putText(annotated, f"fps:{fps:.0f}  n:{len(persons)}",
                            (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (70, 70, 70), 1)

                # Store & broadcast
                with self._lock:
                    self._latest_frame = annotated
                    self._detections   = results
                    self._fps          = fps

                for cb in self._frame_callbacks:
                    try:
                        cb(annotated, results)
                    except Exception as e:
                        log.debug(f"[pipeline] Frame callback error: {e}")

                # NDI / Syphon outputs (respect live toggle)
                if ndi_out and out_cfg.get("ndi_enabled", False):
                    ndi_out.send(annotated)
                if syph_out and out_cfg.get("syphon_enabled", False):
                    syph_out.send(annotated)

                # Throttle
                elapsed = time.time() - t0
                target  = 1.0 / camera_cfg.get("fps_target", 30)
                sleep_t = target - elapsed
                if sleep_t > 0:
                    time.sleep(sleep_t)

        except Exception as e:
            log.error(f"[pipeline] Fatal: {e}", exc_info=True)
            with self._lock:
                self._error   = str(e)
                self._running = False
        finally:
            if camera:  camera.stop()
            if detector: detector.close()
            if ndi_out:  ndi_out.stop()
            if syph_out: syph_out.stop()
            log.info("[pipeline] Stopped")

    def _sync_ndi_output(self, output, cfg: dict):
        enabled = cfg.get("ndi_enabled", False)
        if enabled and output is None:
            try:
                from output.ndi_output import NDIOutput
                output = NDIOutput(name=cfg.get("ndi_name", "ourT-YOLO"))
                output.start()
            except Exception as e:
                log.error(f"[pipeline] NDI output unavailable: {e}")
                with self._lock:
                    self._output_cfg["ndi_enabled"] = False
        elif not enabled and output is not None:
            output.stop()
            output = None
        return output

    def _sync_syphon_output(self, output, cfg: dict):
        enabled = cfg.get("syphon_enabled", False)
        if enabled and output is None:
            try:
                from output.syphon_output import SyphonOutput
                output = SyphonOutput(name=cfg.get("syphon_name", "ourT-YOLO"))
                output.start()
            except Exception as e:
                log.error(f"[pipeline] Syphon output unavailable: {e}")
                with self._lock:
                    self._output_cfg["syphon_enabled"] = False
        elif not enabled and output is not None:
            output.stop()
            output = None
        return output


# ── Drawing helpers ───────────────────────────────────────────────────────────

def _label_color(label: str, colors_cfg: dict) -> tuple:
    key = {"男性化": "masc", "女性化": "fem", "中性": "neutral", "不確定性": "fluid"}.get(label, "neutral")
    bgr = colors_cfg.get(key, [180, 180, 180])
    return tuple(int(v) for v in bgr)


_FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
]


def _chinese_font(size: int) -> ImageFont.FreeTypeFont:
    for font_path in _FONT_PATHS:
        if os.path.exists(font_path):
            return ImageFont.truetype(font_path, size=size)
    return ImageFont.load_default()


def _draw_person(
    frame: np.ndarray,
    bbox: tuple,
    score: GenderScore,
    social: Dict[str, str],
    color: tuple,
) -> None:
    x1, y1, x2, y2 = bbox
    label_lines = [
        f"{score.label}  {score.final:.0f}",
        f"高:{social['height']}  服裝:{social['clothing_colour']}  姿態:{social['posture']}",
        f"職業投射:{social['role_projection']}",
        f"膚色:{social['skin_tone']}  光線:{social['image_light']}",
    ]

    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

    # OpenCV cannot render zh-TW text. Use a macOS CJK font through Pillow.
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image = Image.fromarray(rgb)
    draw = ImageDraw.Draw(image)
    font = _chinese_font(15)
    line_height = 20
    widths = [draw.textbbox((0, 0), line, font=font)[2] for line in label_lines]
    top = max(0, y1 - line_height * len(label_lines) - 6)
    draw.rectangle((x1, top, x1 + max(widths) + 10, y1), fill=(color[2], color[1], color[0]))
    for i, line in enumerate(label_lines):
        draw.text((x1 + 4, top + 2 + i * line_height), line, font=font, fill=(20, 20, 20))
    frame[:] = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def _height_label(bbox_h: int, frame_h: int) -> str:
    r = bbox_h / frame_h
    if r > 0.7:  return "高"
    if r > 0.45: return "中"
    return "矮"
