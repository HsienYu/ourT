"""
camera_source.py

Abstract camera input. Returns OpenCV-compatible frames (BGR numpy arrays).

Supported sources:
  - webcam: USB camera via OpenCV VideoCapture
  - ndi:    NDI receive via ndi-python (must install NDI SDK separately)
  - syphon: Syphon input via syphon-python (macOS only)

Usage:
    source = CameraSource.from_config(cfg)
    source.start()
    frame = source.read()   # BGR ndarray or None
    source.stop()
"""

from __future__ import annotations
import logging
import threading
import time
from abc import ABC, abstractmethod
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)


class CameraSource(ABC):
    @abstractmethod
    def start(self) -> None: ...

    @abstractmethod
    def read(self) -> Optional[np.ndarray]: ...

    @abstractmethod
    def stop(self) -> None: ...

    @property
    @abstractmethod
    def name(self) -> str: ...

    @staticmethod
    def from_config(cfg: dict) -> "CameraSource":
        source_type = cfg.get("source", "webcam")
        if source_type == "webcam":
            return WebcamSource(
                index=cfg.get("webcam_index", 0),
                width=cfg.get("width", 1280),
                height=cfg.get("height", 720),
                fps=cfg.get("fps_target", 30),
            )
        elif source_type == "ndi":
            return NDISource(source_name=cfg.get("ndi_source_name", ""))
        elif source_type == "syphon":
            return SyphonSource(server_name=cfg.get("syphon_server_name", ""))
        else:
            raise ValueError(f"Unknown camera source: {source_type}")


# ── Webcam ────────────────────────────────────────────────────────────────────

class WebcamSource(CameraSource):
    def __init__(self, index: int = 0, width: int = 1280, height: int = 720, fps: int = 30):
        self._index = index
        self._width = width
        self._height = height
        self._fps = fps
        self._cap: Optional[cv2.VideoCapture] = None
        self._frame: Optional[np.ndarray] = None
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    @property
    def name(self) -> str:
        return f"webcam:{self._index}"

    def start(self) -> None:
        self._cap = cv2.VideoCapture(self._index)
        if not self._cap.isOpened():
            raise RuntimeError(f"Cannot open webcam index {self._index}")
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        self._cap.set(cv2.CAP_PROP_FPS, self._fps)
        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        log.info(f"[webcam] Started: {self._width}x{self._height} @ {self._fps}fps")

    def _capture_loop(self) -> None:
        while self._running:
            ret, frame = self._cap.read()
            if ret:
                with self._lock:
                    self._frame = frame
            else:
                log.warning("[webcam] Frame read failed, retrying...")
                time.sleep(0.05)

    def read(self) -> Optional[np.ndarray]:
        with self._lock:
            return self._frame.copy() if self._frame is not None else None

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        if self._cap:
            self._cap.release()
        log.info("[webcam] Stopped")


# ── NDI ───────────────────────────────────────────────────────────────────────

class NDISource(CameraSource):
    """
    NDI receive via ndi-python.
    Requires: pip install ndi-python  AND  NDI SDK installed from ndi.video
    """

    def __init__(self, source_name: str = ""):
        self._source_name = source_name
        self._frame: Optional[np.ndarray] = None
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._receiver = None

    @property
    def name(self) -> str:
        return f"ndi:{self._source_name}"

    def start(self) -> None:
        try:
            import NDIlib as ndi  # type: ignore
        except ImportError:
            raise RuntimeError(
                "ndi-python not installed. Run: pip install ndi-python\n"
                "Also install NDI SDK from https://ndi.video/for-developers/ndi-sdk/"
            )

        if not ndi.initialize():
            raise RuntimeError("NDI initialization failed")

        find = ndi.find_create_v2()
        if find is None:
            raise RuntimeError("Cannot create NDI finder")

        log.info("[ndi] Searching for sources (3s)...")
        ndi.find_wait_for_sources(find, 3000)
        sources = ndi.find_get_current_sources(find)
        ndi.find_destroy(find)

        target = None
        for src in sources:
            log.info(f"[ndi] Found source: {src.ndi_name}")
            if self._source_name in src.ndi_name or not self._source_name:
                target = src
                break

        if target is None:
            raise RuntimeError(
                f"NDI source '{self._source_name}' not found. "
                f"Available: {[s.ndi_name for s in sources]}"
            )

        recv_desc = ndi.RecvCreateV3()
        recv_desc.color_format = ndi.RECV_COLOR_FORMAT_BGRX_BGRA
        self._receiver = ndi.recv_create_v3(recv_desc)
        ndi.recv_connect(self._receiver, target)
        log.info(f"[ndi] Connected to: {target.ndi_name}")

        self._ndi = ndi
        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def _capture_loop(self) -> None:
        while self._running:
            t, v, _, _ = self._ndi.recv_capture_v2(self._receiver, 100)
            if t == self._ndi.FRAME_TYPE_VIDEO:
                arr = np.copy(v.data)
                arr = arr[:, :, :3]  # drop alpha
                with self._lock:
                    self._frame = arr
                self._ndi.recv_free_video_v2(self._receiver, v)

    def read(self) -> Optional[np.ndarray]:
        with self._lock:
            return self._frame.copy() if self._frame is not None else None

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        if self._receiver:
            self._ndi.recv_destroy(self._receiver)
        log.info("[ndi] Stopped")


# ── Syphon ────────────────────────────────────────────────────────────────────

class SyphonSource(CameraSource):
    """
    Syphon input on macOS via syphon-python.
    Requires: pip install syphon-python  (macOS only)
    """

    def __init__(self, server_name: str = ""):
        self._server_name = server_name
        self._frame: Optional[np.ndarray] = None
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    @property
    def name(self) -> str:
        return f"syphon:{self._server_name}"

    def start(self) -> None:
        try:
            import syphon  # type: ignore
        except ImportError:
            raise RuntimeError(
                "syphon-python not installed. Run: pip install syphon-python\n"
                "Only available on macOS."
            )
        import syphon
        servers = syphon.SyphonServerDirectory.servers
        log.info(f"[syphon] Available servers: {[s.name for s in servers]}")

        target = None
        for srv in servers:
            if self._server_name in srv.name or not self._server_name:
                target = srv
                break

        if target is None:
            raise RuntimeError(
                f"Syphon server '{self._server_name}' not found. "
                f"Available: {[s.name for s in servers]}"
            )

        self._client = syphon.SyphonOpenGLClient(target)
        self._syphon = syphon
        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        log.info(f"[syphon] Connected to: {target.name}")

    def _capture_loop(self) -> None:
        while self._running:
            try:
                frame = self._client.new_frame_image()
                if frame is not None:
                    arr = np.array(frame)
                    arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
                    with self._lock:
                        self._frame = arr
            except Exception as e:
                log.debug(f"[syphon] Frame error: {e}")
            time.sleep(1 / 30)

    def read(self) -> Optional[np.ndarray]:
        with self._lock:
            return self._frame.copy() if self._frame is not None else None

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        log.info("[syphon] Stopped")
