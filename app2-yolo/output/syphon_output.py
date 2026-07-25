"""
syphon_output.py

Send annotated frames via Syphon (macOS only).
Requires: pip install syphon-python

In receiving apps (Resolume, VDMX, etc.) look for server named "ourT-YOLO".
"""

from __future__ import annotations
import logging
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)


class SyphonOutput:
    def __init__(self, name: str = "ourT-YOLO"):
        self._name = name
        self._server = None
        self._metal = None   # Metal module kept for texture creation

    def start(self) -> None:
        try:
            import syphon          # type: ignore
            import Metal           # type: ignore
        except ImportError as e:
            raise RuntimeError(
                f"syphon-python or Metal not available: {e}\n"
                "Run: pip install syphon-python  (macOS only)"
            )
        self._metal = Metal
        self._server = syphon.SyphonMetalServer(self._name)
        log.info(f"[syphon-out] Server started: '{self._name}'")

    def send(self, frame_bgr: np.ndarray) -> None:
        if self._server is None or self._metal is None:
            return
        import cv2
        from syphon.utils.numpy import copy_image_to_mtl_texture  # type: ignore

        # Syphon Metal wants RGBA8
        rgba = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGBA)
        h, w = rgba.shape[:2]

        # Allocate a Metal texture
        desc = self._metal.MTLTextureDescriptor.texture2DDescriptorWithPixelFormat_width_height_mipmapped_(
            70,  # MTLPixelFormatRGBA8Unorm = 70
            w, h, False,
        )
        texture = self._server.device.newTextureWithDescriptor_(desc)
        copy_image_to_mtl_texture(rgba, texture)
        self._server.publish_frame_texture(texture)

    def stop(self) -> None:
        if self._server:
            self._server.stop()
        self._server = None
        self._metal = None
        log.info("[syphon-out] Stopped")
