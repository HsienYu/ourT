"""
yolo_detector.py

YOLO person detection with persistent tracker IDs.
"""

from __future__ import annotations
import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
from ultralytics import YOLO

log = logging.getLogger(__name__)


@dataclass
class PersonDetection:
    """A single detected person."""
    bbox: Tuple[int, int, int, int]                      # x1, y1, x2, y2 (pixels)
    confidence: float
    track_id: Optional[int] = None


class YoloDetector:
    def __init__(
        self,
        model_name: str = "yolov8n.pt",
        confidence: float = 0.45,
        device: str = "",
    ):
        log.info(f"[yolo] Loading model: {model_name}")
        self._model = YOLO(model_name)
        self._confidence = confidence
        self._device = device or None

        log.info("[yolo] Model ready")

    def detect(self, frame: np.ndarray) -> List[PersonDetection]:
        """
        Run YOLO tracking and return person bounding boxes.
        Returns list of PersonDetection objects.
        """
        h, w = frame.shape[:2]
        results = self._model.track(
            frame,
            classes=[0],           # class 0 = person
            conf=self._confidence,
            persist=True,
            verbose=False,
            device=self._device,
        )

        detections: List[PersonDetection] = []
        if not results or results[0].boxes is None:
            return detections

        boxes = results[0].boxes
        for box in boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w - 1, x2), min(h - 1, y2)

            conf = float(box.conf[0])
            track_id = int(box.id[0]) if box.id is not None else None

            detections.append(PersonDetection(
                bbox=(x1, y1, x2, y2),
                confidence=conf,
                track_id=track_id,
            ))

        return detections

    def close(self) -> None:
        pass
