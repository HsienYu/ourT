"""
app.py — App 2: YOLO Camera — PyQt6 Standalone GUI

Run:
  cd app2-yolo
  source venv/bin/activate
  python app.py

Layout:
  ┌─────────────────────────────────────────────────────┐
  │  header bar: title + status + fps                   │
  ├──────────────────────────┬──────────────────────────┤
  │                          │  CONTROLS                │
  │   live camera feed       │  Camera selector         │
   │   (annotated, fills      │  Output toggles          │
   │    left panel)           │                          │
  │                          │  NDI / Syphon toggles    │
  │                          │  Detection list          │
  └──────────────────────────┴──────────────────────────┘
"""

from __future__ import annotations

import os
import sys
import logging
import threading
from pathlib import Path
from typing import List, Optional

# ── Suppress noisy C++ logs before any other import ──────────────────────────
os.environ.setdefault("GLOG_minloglevel", "3")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("YOLO_VERBOSE", "False")

# ── Bundle-aware resource directory (py2app vs. dev) ────────────────────────
def _resource_dir() -> Path:
    """Contents/Resources/ in a frozen bundle; __file__'s parent in dev."""
    if getattr(sys, 'frozen', False):
        # py2app places the stub executable at Contents/MacOS/<name>
        return Path(sys.executable).parent.parent / 'Resources'
    return Path(__file__).parent

RESOURCE_DIR = _resource_dir()
os.chdir(str(RESOURCE_DIR))   # CWD = resource dir before any pipeline imports

import cv2
import numpy as np
import yaml

from PyQt6.QtCore import (
    Qt, QTimer, pyqtSignal, QObject,
)
from PyQt6.QtGui import (
    QImage, QPixmap, QColor, QPalette,
)
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QLabel,
    QPushButton,
    QVBoxLayout, QHBoxLayout, QScrollArea,
    QFrame, QComboBox, QSizePolicy,
    QGroupBox,
)

import uvicorn
from main import app as fastapi_app
from pipeline import Pipeline, DetectionResult

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logging.getLogger("ultralytics").setLevel(logging.ERROR)
log = logging.getLogger("app")

# ── Load config ───────────────────────────────────────────────────────────────
CONFIG_PATH = RESOURCE_DIR / "config.yaml"

def load_cfg() -> dict:
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return yaml.safe_load(f)

# ── Dark palette ──────────────────────────────────────────────────────────────
BG       = "#0a0a0a"
PANEL    = "#111111"
BORDER   = "#222222"
TEXT     = "#dddddd"
MUTED    = "#555555"
ACCENT   = "#e0d0ff"
OK       = "#44ffaa"
DANGER   = "#ff6080"

STYLE = f"""
QWidget {{
    background-color: {BG};
    color: {TEXT};
    font-family: 'Courier New', monospace;
    font-size: 12px;
}}
QFrame#sidebar {{
    background-color: {PANEL};
    border-left: 1px solid {BORDER};
}}
QLabel#sectionTitle {{
    font-size: 9px;
    letter-spacing: 3px;
    color: {MUTED};
    text-transform: uppercase;
    border-bottom: 1px solid {BORDER};
    padding-bottom: 4px;
    margin-bottom: 2px;
}}
QLabel#statusBar {{
    background-color: {PANEL};
    border-top: 1px solid {BORDER};
    color: {MUTED};
    font-size: 10px;
    padding: 4px 12px;
    letter-spacing: 1px;
}}
QPushButton {{
    background: transparent;
    border: 1px solid {BORDER};
    color: {MUTED};
    padding: 6px 10px;
    font-family: 'Courier New', monospace;
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
}}
QPushButton:hover  {{ border-color: #444; color: {TEXT}; }}
QPushButton:checked {{ border-color: {ACCENT}; color: {ACCENT}; background: rgba(224,208,255,0.07); }}
QPushButton#ok:checked   {{ border-color: {OK};     color: {OK};     background: rgba(68,255,170,0.07); }}
QComboBox {{
    background: #000;
    border: 1px solid {BORDER};
    color: {TEXT};
    font-family: 'Courier New', monospace;
    font-size: 12px;
    padding: 4px 8px;
}}
QComboBox QAbstractItemView {{
    background: #111;
    color: {TEXT};
    selection-background-color: #222;
}}
QComboBox::drop-down {{ border: none; }}
QScrollArea {{ border: none; }}
QScrollBar:vertical {{
    background: {BG};
    width: 4px;
}}
QScrollBar::handle:vertical {{
    background: {BORDER};
    border-radius: 2px;
}}
QGroupBox {{
    border: 1px solid {BORDER};
    margin-top: 8px;
    font-size: 9px;
    letter-spacing: 2px;
    color: {MUTED};
    padding: 6px 6px 6px 6px;
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    left: 6px;
    padding: 0 4px;
}}
"""


# ── Frame bridge: pipeline thread → Qt main thread ───────────────────────────

class FrameBridge(QObject):
    """Emits signals from the pipeline thread into Qt's event loop."""
    frame_ready = pyqtSignal(np.ndarray, list)   # annotated frame + detections

    def on_frame(self, frame: np.ndarray, detections: list) -> None:
        self.frame_ready.emit(frame, detections)


# ── Camera video widget ───────────────────────────────────────────────────────

class VideoWidget(QLabel):
    """Displays annotated frames, preserving aspect ratio."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setMinimumSize(640, 360)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._show_placeholder()

    def _show_placeholder(self):
        self.setText("等待畫面…\nWaiting for camera")
        self.setStyleSheet(
            f"color: {MUTED}; font-size: 14px; letter-spacing: 2px;"
            f"background: #050505;"
        )

    def update_frame(self, bgr: np.ndarray) -> None:
        h, w = bgr.shape[:2]
        rgb  = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        img  = QImage(rgb.data, w, h, rgb.strides[0], QImage.Format.Format_RGB888)
        pix  = QPixmap.fromImage(img)
        self.setPixmap(
            pix.scaled(
                self.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
        )
        self.setStyleSheet("")   # clear placeholder style


# ── Detection list widget ─────────────────────────────────────────────────────

class DetectionListWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._layout.setSpacing(3)
        self._placeholder = QLabel("無人在框內")
        self._placeholder.setStyleSheet(f"color: {MUTED}; font-size: 11px;")
        self._layout.addWidget(self._placeholder)

    def update_detections(self, detections: List[DetectionResult]) -> None:
        # Clear
        while self._layout.count():
            item = self._layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        if not detections:
            lbl = QLabel("無人在框內")
            lbl.setStyleSheet(f"color: {MUTED}; font-size: 11px;")
            self._layout.addWidget(lbl)
            return

        for d in detections:
            row = QWidget()
            row.setStyleSheet(f"border: 1px solid {BORDER}; padding: 2px;")
            rl = QHBoxLayout(row)
            rl.setContentsMargins(6, 3, 6, 3)

            label = QLabel(f"標籤:{d.label}")
            label.setStyleSheet(f"color: {ACCENT}; font-size: 11px; border: none;")
            rl.addWidget(label)
            self._layout.addWidget(row)

        self._layout.addStretch()


# ── Section title helper ──────────────────────────────────────────────────────

def section_title(text: str) -> QLabel:
    lbl = QLabel(text.upper())
    lbl.setObjectName("sectionTitle")
    return lbl



def _detect_available_devices() -> list:
    """Return [{label, value}] for available torch compute backends."""
    import torch
    devices = [{"label": "Auto", "value": ""}]
    if torch.backends.mps.is_available():
        devices.append({"label": "MPS  (Apple GPU)", "value": "mps"})
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            name = torch.cuda.get_device_name(i)
            devices.append({"label": f"CUDA:{i}  ({name})", "value": f"cuda:{i}"})
    devices.append({"label": "CPU", "value": "cpu"})
    return devices

# ── Sidebar panel ─────────────────────────────────────────────────────────────

class Sidebar(QFrame):
    config_changed = pyqtSignal(dict)   # emits patch dict for Pipeline.update_config()
    camera_changed = pyqtSignal(int)    # emits new webcam index
    device_changed = pyqtSignal(str)    # emits device string; MainWindow restarts pipeline

    def __init__(self, cfg: dict, cameras: list, parent=None):
        super().__init__(parent)
        self.setObjectName("sidebar")
        self.setFixedWidth(300)
        self._cfg = cfg

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(14)

        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        inner = QWidget()
        self._vbox = QVBoxLayout(inner)
        self._vbox.setContentsMargins(0, 0, 0, 0)
        self._vbox.setSpacing(16)
        scroll_area.setWidget(inner)
        root.addWidget(scroll_area)

        self._build_camera_section(cameras)
        self._build_device_section(cfg)
        self._build_output_section(cfg)
        self._build_detections_section()

        self._vbox.addStretch()

    # ── Camera section ────────────────────────────────────────────────────────

    def _build_camera_section(self, cameras: list) -> None:
        g = QGroupBox("CAMERA / 攝影機")
        gl = QVBoxLayout(g)
        gl.setSpacing(6)

        self._cam_combo = QComboBox()
        for c in cameras:
            self._cam_combo.addItem(c["name"], c["index"])
        if not cameras:
            self._cam_combo.addItem("No cameras found", -1)
        self._cam_combo.currentIndexChanged.connect(self._on_camera_change)
        gl.addWidget(self._cam_combo)

        self._vbox.addWidget(g)

    def _on_camera_change(self, _idx: int) -> None:
        cam_index = self._cam_combo.currentData()
        if cam_index is not None and cam_index >= 0:
            self.camera_changed.emit(cam_index)

    # ── Compute device section ────────────────────────────────────────────────

    def _build_device_section(self, cfg: dict) -> None:
        g = QGroupBox("COMPUTE / 運算裝置")
        gl = QVBoxLayout(g)
        gl.setSpacing(6)

        current = cfg.get("yolo", {}).get("device", "")
        devices = _detect_available_devices()
        self._device_combo = QComboBox()
        sel = 0
        for i, d in enumerate(devices):
            self._device_combo.addItem(d["label"], d["value"])
            if d["value"] == current:
                sel = i
        self._device_combo.setCurrentIndex(sel)
        self._device_combo.currentIndexChanged.connect(self._on_device_change)
        gl.addWidget(self._device_combo)

        self._vbox.addWidget(g)

    def _on_device_change(self, _idx: int) -> None:
        device = self._device_combo.currentData()
        if device is not None:
            self.device_changed.emit(device)

    # ── Output section (NDI / Syphon) ─────────────────────────────────────────

    def _build_output_section(self, cfg: dict) -> None:
        g = QGroupBox("OUTPUT / 輸出")
        gl = QVBoxLayout(g)
        gl.setSpacing(6)

        out = cfg.get("output", {})
        import socket
        host = socket.gethostname().split('.')[0].upper()

        # NDI
        self._ndi_btn = QPushButton("NDI Output  OFF")
        self._ndi_btn.setCheckable(True)
        self._ndi_btn.setChecked(out.get("ndi_enabled", False))
        self._ndi_btn.setObjectName("ok")
        self._ndi_btn.toggled.connect(self._on_ndi_toggle)
        gl.addWidget(self._ndi_btn)
        ndi_name = out.get("ndi_name", "ourT-YOLO")
        self._ndi_hint = QLabel(f'OBS: find "{host} ({ndi_name})"')
        self._ndi_hint.setStyleSheet(
            f"color: {MUTED}; font-size: 9px; padding-left: 4px;"
        )
        gl.addWidget(self._ndi_hint)

        # Syphon
        self._syphon_btn = QPushButton("Syphon Output  OFF")
        self._syphon_btn.setCheckable(True)
        self._syphon_btn.setChecked(out.get("syphon_enabled", False))
        self._syphon_btn.setObjectName("ok")
        self._syphon_btn.toggled.connect(self._on_syphon_toggle)
        gl.addWidget(self._syphon_btn)
        syphon_name = out.get("syphon_name", "ourT-YOLO")
        self._syphon_hint = QLabel(f'Syphon server: "{syphon_name}"')
        self._syphon_hint.setStyleSheet(
            f"color: {MUTED}; font-size: 9px; padding-left: 4px;"
        )
        gl.addWidget(self._syphon_hint)

        self._vbox.addWidget(g)

    def _on_ndi_toggle(self, checked: bool) -> None:
        self._ndi_btn.setText(f"NDI Output  {'ON' if checked else 'OFF'}")
        self.config_changed.emit({"output": {"ndi_enabled": checked}})

    def _on_syphon_toggle(self, checked: bool) -> None:
        self._syphon_btn.setText(f"Syphon Output  {'ON' if checked else 'OFF'}")
        self.config_changed.emit({"output": {"syphon_enabled": checked}})

    def update_output_state(self, ndi_on: bool, syphon_on: bool) -> None:
        """Sync button visual state when the pipeline silently disables an output."""
        for btn, on, label in (
            (self._ndi_btn,    ndi_on,    "NDI Output"),
            (self._syphon_btn, syphon_on, "Syphon Output"),
        ):
            if btn.isChecked() != on:
                btn.blockSignals(True)
                btn.setChecked(on)
                btn.setText(f"{label}  {'ON' if on else 'OFF'}")
                btn.blockSignals(False)

    # ── Detection list section ────────────────────────────────────────────────

    def _build_detections_section(self) -> None:
        g = QGroupBox("DETECTIONS / 即時偵測")
        gl = QVBoxLayout(g)
        gl.setContentsMargins(4, 8, 4, 4)
        self.det_list = DetectionListWidget()
        gl.addWidget(self.det_list)
        self._vbox.addWidget(g)


# ── Main window ───────────────────────────────────────────────────────────────

class MainWindow(QMainWindow):
    def __init__(self, cfg: dict):
        super().__init__()
        self.setWindowTitle("ourT — YOLO Camera")
        self.resize(1200, 720)

        self._cfg = cfg
        self._pipeline: Optional[Pipeline] = None
        self._bridge = FrameBridge()

        # Start embedded FastAPI server so /panel and /preview are reachable
        # even without running main.py separately.
        self._start_fastapi_server()
        self._bridge.frame_ready.connect(self._on_frame)

        # ── Central widget ────────────────────────────────────────────────────
        central = QWidget()
        self.setCentralWidget(central)
        root_h = QHBoxLayout(central)
        root_h.setContentsMargins(0, 0, 0, 0)
        root_h.setSpacing(0)

        # Left: video
        left = QWidget()
        left_v = QVBoxLayout(left)
        left_v.setContentsMargins(0, 0, 0, 0)
        left_v.setSpacing(0)

        self._header = QLabel("ourT — YOLO CAMERA")
        self._header.setStyleSheet(
            f"background: {PANEL}; border-bottom: 1px solid {BORDER};"
            f"padding: 8px 14px; font-size: 11px; letter-spacing: 3px; color: {MUTED};"
        )
        left_v.addWidget(self._header)

        self._video = VideoWidget()
        left_v.addWidget(self._video)

        self._status = QLabel("連線中… / Starting pipeline")
        self._status.setObjectName("statusBar")
        left_v.addWidget(self._status)

        root_h.addWidget(left, stretch=1)

        # Right: sidebar
        cameras = Pipeline.list_cameras()
        self._sidebar = Sidebar(cfg, cameras)
        self._sidebar.config_changed.connect(self._on_config_change)
        self._sidebar.camera_changed.connect(self._on_camera_change)
        self._sidebar.device_changed.connect(self._on_device_change)
        root_h.addWidget(self._sidebar)

        # ── Start pipeline ────────────────────────────────────────────────────
        self._start_pipeline(cfg)

        # ── Status refresh timer ──────────────────────────────────────────────
        self._status_timer = QTimer(self)
        self._status_timer.timeout.connect(self._refresh_status)
        self._status_timer.start(1000)

    # ── Pipeline management ───────────────────────────────────────────────────

    def _start_pipeline(self, cfg: dict) -> None:
        if self._pipeline:
            self._pipeline.stop()
        self._pipeline = Pipeline(cfg)
        self._pipeline.on_frame(self._bridge.on_frame)
        self._pipeline.start()
        log.info("[app] Pipeline started")

    def _on_camera_change(self, cam_index: int) -> None:
        """Restart pipeline with new camera index."""
        new_cfg = dict(self._cfg)
        new_cfg["camera"] = {**new_cfg.get("camera", {}), "source": "webcam", "webcam_index": cam_index}
        self._cfg = new_cfg
        self._start_pipeline(new_cfg)
        log.info(f"[app] Camera changed to index {cam_index}")

    def _on_device_change(self, device: str) -> None:
        """Restart pipeline with the selected compute device."""
        self._cfg = {**self._cfg, "yolo": {**self._cfg.get("yolo", {}), "device": device}}
        self._start_pipeline(self._cfg)
        log.info(f"[app] Compute device → {device or 'auto'}")

    def _on_config_change(self, patch: dict) -> None:
        if self._pipeline:
            self._pipeline.update_config(patch)

    # ── Frame display ─────────────────────────────────────────────────────────

    def _on_frame(self, frame: np.ndarray, detections: List[DetectionResult]) -> None:
        self._video.update_frame(frame)
        self._sidebar.det_list.update_detections(detections)

    # ── Status bar update ─────────────────────────────────────────────────────

    def _refresh_status(self) -> None:
        if not self._pipeline:
            return
        snap = self._pipeline.snapshot()
        if snap.error:
            self._status.setText(f"ERROR: {snap.error}")
            self._status.setStyleSheet(
                f"background: {PANEL}; border-top: 1px solid {BORDER};"
                f"color: {DANGER}; font-size: 10px; padding: 4px 12px; letter-spacing: 1px;"
            )
        else:
            n = len(snap.detections)
            self._status.setText(
                f"fps: {snap.fps:.0f}    偵測: {n} 人"
            )
            self._status.setStyleSheet(
                f"background: {PANEL}; border-top: 1px solid {BORDER};"
                f"color: {MUTED}; font-size: 10px; padding: 4px 12px; letter-spacing: 1px;"
            )
        # Keep NDI/Syphon buttons in sync with actual pipeline state
        out = snap.output_cfg
        self._sidebar.update_output_state(
            ndi_on=out.get("ndi_enabled", False),
            syphon_on=out.get("syphon_enabled", False),
        )

    # ── Cleanup ───────────────────────────────────────────────────────────────

    # ── Embedded FastAPI server ───────────────────────────────────────────────

    def _start_fastapi_server(self) -> None:
        """Run the FastAPI web server in a background daemon thread.

        This makes http://localhost:3001/panel and /preview available
        when the GUI is launched without running main.py separately.
        The pipeline singleton in main.py is shared with this GUI process.
        """
        import yaml as _yaml
        server_cfg = {}
        try:
            server_cfg = _yaml.safe_load(
                open(RESOURCE_DIR / "config.yaml", encoding='utf-8')
            ).get("server", {})
        except Exception:
            pass

        port = server_cfg.get("port", 3001)
        host = server_cfg.get("host", "0.0.0.0")

        def _run():
            uvicorn.run(fastapi_app, host=host, port=port, log_level="error")

        t = threading.Thread(target=_run, daemon=True, name="fastapi")
        t.start()
        log.info(f"[app] FastAPI server started on {host}:{port}")

    def closeEvent(self, event):
        if self._pipeline:
            self._pipeline.stop()
        event.accept()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    cfg = load_cfg()

    app = QApplication(sys.argv)
    app.setStyleSheet(STYLE)

    # Force dark window decorations on macOS
    app.setStyle("Fusion")
    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window,          QColor(BG))
    palette.setColor(QPalette.ColorRole.WindowText,      QColor(TEXT))
    palette.setColor(QPalette.ColorRole.Base,            QColor("#000000"))
    palette.setColor(QPalette.ColorRole.AlternateBase,   QColor(PANEL))
    palette.setColor(QPalette.ColorRole.Text,            QColor(TEXT))
    palette.setColor(QPalette.ColorRole.Button,          QColor(PANEL))
    palette.setColor(QPalette.ColorRole.ButtonText,      QColor(TEXT))
    palette.setColor(QPalette.ColorRole.Highlight,       QColor(ACCENT))
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor("#000000"))
    app.setPalette(palette)

    win = MainWindow(cfg)
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
