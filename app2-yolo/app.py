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
  │   (annotated, fills      │  Bias slider             │
  │    left panel)           │  Oscillation / Randomize │
  │                          │  Custom labels           │
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

import cv2
import numpy as np
import yaml

from PyQt6.QtCore import (
    Qt, QTimer, QThread, pyqtSignal, QObject, QSize,
)
from PyQt6.QtGui import (
    QImage, QPixmap, QFont, QColor, QPalette, QIcon,
)
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QLabel,
    QSlider, QPushButton, QCheckBox, QLineEdit,
    QVBoxLayout, QHBoxLayout, QGridLayout, QScrollArea,
    QFrame, QComboBox, QSizePolicy, QSplitter,
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
CONFIG_PATH = Path(__file__).parent / "config.yaml"

def load_cfg() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)

# ── Dark palette ──────────────────────────────────────────────────────────────
BG       = "#0a0a0a"
PANEL    = "#111111"
BORDER   = "#222222"
TEXT     = "#dddddd"
MUTED    = "#555555"
ACCENT   = "#e0d0ff"
ACCENT2  = "#ffd0e0"
OK       = "#44ffaa"
WARN     = "#ffcc44"
DANGER   = "#ff6080"
MASC     = "#6080ff"
FEM      = "#ff6080"
NEUTRAL  = "#80ff80"
FLUID    = "#ffdc64"

LABEL_COLORS = {"男性化": MASC, "女性化": FEM, "中性": NEUTRAL, "不確定性": FLUID}

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
QSlider::groove:horizontal {{
    height: 2px;
    background: {BORDER};
}}
QSlider::handle:horizontal {{
    background: {ACCENT};
    width: 14px;
    height: 14px;
    margin: -6px 0;
    border-radius: 7px;
}}
QSlider::sub-page:horizontal {{
    background: {ACCENT};
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
QPushButton#warn:checked {{ border-color: {WARN};   color: {WARN};   background: rgba(255,204,68,0.07); }}
QPushButton#ok:checked   {{ border-color: {OK};     color: {OK};     background: rgba(68,255,170,0.07); }}
QLineEdit {{
    background: #000;
    border: 1px solid {BORDER};
    color: {TEXT};
    font-family: 'Courier New', monospace;
    font-size: 12px;
    padding: 4px 8px;
}}
QLineEdit:focus {{ border-color: #444; }}
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

            id_lbl = QLabel(f"#{d.track_id or '?'}")
            id_lbl.setStyleSheet(f"color: {MUTED}; font-size: 10px; border: none;")

            score_lbl = QLabel(f"{d.score:.0f}")
            score_lbl.setStyleSheet(f"color: {TEXT}; font-size: 11px; border: none;")

            tag_color = LABEL_COLORS.get(d.label, MUTED)
            tag = QLabel(d.label)
            tag.setStyleSheet(
                f"color: {tag_color}; border: 1px solid {tag_color};"
                f"padding: 1px 6px; font-size: 10px;"
            )

            meta = QLabel(
                f"高:{d.height}  服裝:{d.clothing_colour}  姿態:{d.posture}\n"
                f"職業投射:{d.role_projection}  膚色:{d.skin_tone}  光線:{d.image_light}"
            )
            meta.setStyleSheet(f"color: {MUTED}; font-size: 9px; border: none;")

            details = QVBoxLayout()
            details.setSpacing(1)
            top = QHBoxLayout()
            top.addWidget(id_lbl)
            top.addWidget(score_lbl)
            top.addStretch()
            top.addWidget(tag)
            details.addLayout(top)
            details.addWidget(meta)
            rl.addLayout(details)
            self._layout.addWidget(row)

        self._layout.addStretch()


# ── Section title helper ──────────────────────────────────────────────────────

def section_title(text: str) -> QLabel:
    lbl = QLabel(text.upper())
    lbl.setObjectName("sectionTitle")
    return lbl


# ── Sidebar panel ─────────────────────────────────────────────────────────────

class Sidebar(QFrame):
    config_changed = pyqtSignal(dict)   # emits patch dict for Pipeline.update_config()
    camera_changed = pyqtSignal(int)    # emits new webcam index

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
        self._build_bias_section(cfg)
        self._build_mode_section()
        self._build_labels_section(cfg)
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

    # ── Bias section ──────────────────────────────────────────────────────────

    def _build_bias_section(self, cfg: dict) -> None:
        g = QGroupBox("CLASSIFICATION BIAS / 標籤偏移")
        gl = QVBoxLayout(g)
        gl.setSpacing(6)

        # Axis labels
        axis_row = QHBoxLayout()
        l_masc = QLabel("← 男性化")
        l_masc.setStyleSheet(f"color: {MASC}; font-size: 10px;")
        l_mid  = QLabel("中性")
        l_mid.setAlignment(Qt.AlignmentFlag.AlignCenter)
        l_mid.setStyleSheet(f"color: {MUTED}; font-size: 10px;")
        l_fem  = QLabel("女性化 →")
        l_fem.setAlignment(Qt.AlignmentFlag.AlignRight)
        l_fem.setStyleSheet(f"color: {FEM}; font-size: 10px;")
        axis_row.addWidget(l_masc)
        axis_row.addWidget(l_mid)
        axis_row.addWidget(l_fem)
        gl.addLayout(axis_row)

        bias_row = QHBoxLayout()
        self._bias_slider = QSlider(Qt.Orientation.Horizontal)
        self._bias_slider.setRange(-50, 50)
        self._bias_slider.setValue(cfg.get("heuristics", {}).get("bias", 0))
        self._bias_slider.setTickInterval(10)
        self._bias_val = QLabel(f"{self._bias_slider.value():+d}")
        self._bias_val.setStyleSheet(f"color: {ACCENT}; font-size: 11px; min-width: 32px;")
        self._bias_val.setAlignment(Qt.AlignmentFlag.AlignRight)
        self._bias_slider.valueChanged.connect(self._on_bias_change)
        bias_row.addWidget(self._bias_slider)
        bias_row.addWidget(self._bias_val)
        gl.addLayout(bias_row)

        self._vbox.addWidget(g)

    def _on_bias_change(self, val: int) -> None:
        self._bias_val.setText(f"{val:+d}")
        self.config_changed.emit({"heuristics": {"bias": val}})

    # ── Oscillation / Randomize section ──────────────────────────────────────

    def _build_mode_section(self) -> None:
        g = QGroupBox("INSTABILITY MODE / 不穩定模式")
        gl = QVBoxLayout(g)
        gl.setSpacing(6)

        self._osc_btn = QPushButton("震盪模式  OFF")
        self._osc_btn.setCheckable(True)
        self._osc_btn.setObjectName("warn")
        self._osc_btn.toggled.connect(self._on_osc_toggle)
        gl.addWidget(self._osc_btn)

        self._rand_btn = QPushButton("隨機擾動  OFF")
        self._rand_btn.setCheckable(True)
        self._rand_btn.setObjectName("warn")
        self._rand_btn.toggled.connect(self._on_rand_toggle)
        gl.addWidget(self._rand_btn)

        self._vbox.addWidget(g)

    def _on_osc_toggle(self, checked: bool) -> None:
        self._osc_btn.setText(f"震盪模式  {'ON' if checked else 'OFF'}")
        self.config_changed.emit({"heuristics": {"oscillation": checked}})

    def _on_rand_toggle(self, checked: bool) -> None:
        self._rand_btn.setText(f"隨機擾動  {'ON' if checked else 'OFF'}")
        self.config_changed.emit({"heuristics": {"randomize": checked}})

    # ── Custom labels section ─────────────────────────────────────────────────

    def _build_labels_section(self, cfg: dict) -> None:
        g = QGroupBox("LABELS / 標籤文字")
        gl = QGridLayout(g)
        gl.setSpacing(6)

        labels = cfg.get("labels", {})
        self._label_inputs: dict[str, QLineEdit] = {}

        pairs = [
            ("masc",    "男性化", MASC),
            ("fem",     "女性化", FEM),
            ("neutral", "中性",   NEUTRAL),
            ("fluid",   "不確定性", FLUID),
        ]

        for row, (key, default, color) in enumerate(pairs):
            lbl = QLabel(default)
            lbl.setStyleSheet(f"color: {color}; font-size: 10px;")
            inp = QLineEdit(labels.get(key, default))
            inp.setStyleSheet(inp.styleSheet() + f" border-color: {color};")
            inp.textChanged.connect(lambda text, k=key: self._on_label_change(k, text))
            self._label_inputs[key] = inp
            gl.addWidget(lbl, row, 0)
            gl.addWidget(inp, row, 1)

        self._vbox.addWidget(g)

    def _on_label_change(self, key: str, text: str) -> None:
        self.config_changed.emit({"labels": {key: text}})

    # ── Output section (NDI / Syphon) ─────────────────────────────────────────

    def _build_output_section(self, cfg: dict) -> None:
        g = QGroupBox("OUTPUT / 輸出")
        gl = QVBoxLayout(g)
        gl.setSpacing(6)

        out = cfg.get("output", {})

        self._ndi_btn = QPushButton("NDI Output  OFF")
        self._ndi_btn.setCheckable(True)
        self._ndi_btn.setChecked(out.get("ndi_enabled", False))
        self._ndi_btn.setObjectName("ok")
        self._ndi_btn.toggled.connect(self._on_ndi_toggle)
        gl.addWidget(self._ndi_btn)

        self._syphon_btn = QPushButton("Syphon Output  OFF")
        self._syphon_btn.setCheckable(True)
        self._syphon_btn.setChecked(out.get("syphon_enabled", False))
        self._syphon_btn.setObjectName("ok")
        self._syphon_btn.toggled.connect(self._on_syphon_toggle)
        gl.addWidget(self._syphon_btn)

        self._vbox.addWidget(g)

    def _on_ndi_toggle(self, checked: bool) -> None:
        self._ndi_btn.setText(f"NDI Output  {'ON' if checked else 'OFF'}")
        self.config_changed.emit({"output": {"ndi_enabled": checked}})

    def _on_syphon_toggle(self, checked: bool) -> None:
        self._syphon_btn.setText(f"Syphon Output  {'ON' if checked else 'OFF'}")
        self.config_changed.emit({"output": {"syphon_enabled": checked}})

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
                f"fps: {snap.fps:.0f}    偵測: {n} 人    "
                f"bias: {snap.heuristics_cfg.get('bias', 0):+d}    "
                f"{'震盪 ON  ' if snap.heuristics_cfg.get('oscillation') else ''}"
                f"{'隨機 ON' if snap.heuristics_cfg.get('randomize') else ''}"
            )
            self._status.setStyleSheet(
                f"background: {PANEL}; border-top: 1px solid {BORDER};"
                f"color: {MUTED}; font-size: 10px; padding: 4px 12px; letter-spacing: 1px;"
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
            with open(Path(__file__).parent / "config.yaml") as f:
                server_cfg = _yaml.safe_load(f).get("server", {})
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
