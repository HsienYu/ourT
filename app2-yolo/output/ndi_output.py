"""
ndi_output.py

Send annotated frames as an NDI video stream.
Requires: pip install ndi-python  AND  NDI SDK from ndi.video
"""

from __future__ import annotations
import logging
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)


class NDIOutput:
    def __init__(self, name: str = "ourT-YOLO"):
        self._name = name
        self._sender = None
        self._ndi = None

    def start(self) -> None:
        try:
            import NDIlib as ndi  # type: ignore
        except ImportError:
            raise RuntimeError(
                "ndi-python not installed.\n"
                "Run: pip install ndi-python\n"
                "Install NDI SDK from https://ndi.video/for-developers/ndi-sdk/"
            )

        if not ndi.initialize():
            raise RuntimeError("NDI initialization failed")

        send_desc = ndi.SendCreate()
        send_desc.ndi_name = self._name
        self._sender = ndi.send_create(send_desc)
        if self._sender is None:
            raise RuntimeError("Cannot create NDI sender")

        self._ndi = ndi
        log.info(f"[ndi-out] Sending as '{self._name}'")

    def send(self, frame_bgr: np.ndarray) -> None:
        if self._sender is None or self._ndi is None:
            return
        # NDI expects BGRX (4 channels)
        import cv2
        bgrx = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2BGRA)
        h, w = bgrx.shape[:2]

        video_frame = self._ndi.VideoFrameV2()
        video_frame.data = bgrx
        video_frame.FourCC = self._ndi.FOURCC_VIDEO_TYPE_BGRX
        video_frame.xres = w
        video_frame.yres = h
        video_frame.frame_rate_N = 30
        video_frame.frame_rate_D = 1
        self._ndi.send_send_video_v2(self._sender, video_frame)

    def stop(self) -> None:
        if self._sender and self._ndi:
            self._ndi.send_destroy(self._sender)
        log.info("[ndi-out] Stopped")
