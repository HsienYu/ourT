"""
syphon_output.py

Send annotated frames via Syphon (macOS only).
Requires: pip install syphon-python
"""

from __future__ import annotations
import logging

import numpy as np

log = logging.getLogger(__name__)


class SyphonOutput:
    def __init__(self, name: str = "ourT-YOLO"):
        self._name = name
        self._server = None

    def start(self) -> None:
        try:
            import syphon  # type: ignore
        except ImportError:
            raise RuntimeError(
                "syphon-python not installed. Run: pip install syphon-python\n"
                "Only available on macOS."
            )
        import syphon
        self._server = syphon.SyphonMetalServer(self._name)
        self._syphon = syphon
        log.info(f"[syphon-out] Server started: '{self._name}'")

    def send(self, frame_bgr: np.ndarray) -> None:
        if self._server is None:
            return
        import cv2
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        self._server.publish_frame_nparray(rgb)

    def stop(self) -> None:
        if self._server:
            self._server.stop()
        log.info("[syphon-out] Stopped")
