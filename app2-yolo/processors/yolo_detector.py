"""
yolo_detector.py

YOLOv8 person detection. Returns per-person bounding boxes and pose keypoints.
Wraps Ultralytics YOLOv8 (detection) and MediaPipe Tasks PoseLandmarker
(keypoints for the gender heuristics module).

MediaPipe 0.10+ dropped mp.solutions — this file uses the Tasks API instead.
Requires: pose_landmarker_lite.task in the app2-yolo/ directory.
Download script: see main.py startup or run manually:
  python -c "
  import urllib.request
  urllib.request.urlretrieve(
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
    'pose_landmarker_lite.task')
  "
"""

from __future__ import annotations
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from ultralytics import YOLO

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from mediapipe.tasks.python.vision import PoseLandmarkerOptions, RunningMode

log = logging.getLogger(__name__)

# Path to the .task model file — sits next to this package's parent dir
_MODEL_PATH = str(Path(__file__).parent.parent / "pose_landmarker_lite.task")
_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)

# MediaPipe PoseLandmarker keypoint indices (33 landmarks)
KP_LEFT_SHOULDER  = 11
KP_RIGHT_SHOULDER = 12
KP_LEFT_HIP       = 23
KP_RIGHT_HIP      = 24


def _ensure_model() -> None:
    """Download the .task model file if not present."""
    if os.path.exists(_MODEL_PATH):
        return
    import urllib.request
    log.info(f"[pose] Downloading pose_landmarker_lite.task to {_MODEL_PATH}...")
    urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)
    log.info("[pose] Download complete.")


@dataclass
class PersonDetection:
    """A single detected person."""
    bbox: Tuple[int, int, int, int]                      # x1, y1, x2, y2 (pixels)
    confidence: float
    track_id: Optional[int] = None
    # Pose keypoints: list of (x_norm, y_norm, visibility) — None if pose failed
    keypoints: Optional[List[Tuple[float, float, float]]] = None
    # BGR crops for color sampling
    upper_crop: Optional[np.ndarray] = None              # torso above mid
    lower_crop: Optional[np.ndarray] = None              # torso below mid


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

        # MediaPipe Tasks PoseLandmarker
        _ensure_model()
        options = PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=_MODEL_PATH),
            running_mode=RunningMode.IMAGE,
            num_poses=10,
            min_pose_detection_confidence=0.4,
            min_pose_presence_confidence=0.4,
            min_tracking_confidence=0.4,
        )
        self._landmarker = mp_vision.PoseLandmarker.create_from_options(options)
        log.info("[yolo] Model and MediaPipe PoseLandmarker ready")

    def detect(self, frame: np.ndarray) -> List[PersonDetection]:
        """
        Run YOLOv8 tracking on frame, then MediaPipe Pose on each person crop.
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

            person_crop = frame[y1:y2, x1:x2]
            if person_crop.size == 0:
                continue

            keypoints = self._get_pose_keypoints(person_crop)
            upper_crop, lower_crop = self._split_torso(person_crop)

            detections.append(PersonDetection(
                bbox=(x1, y1, x2, y2),
                confidence=conf,
                track_id=track_id,
                keypoints=keypoints,
                upper_crop=upper_crop,
                lower_crop=lower_crop,
            ))

        return detections

    def _get_pose_keypoints(
        self, crop: np.ndarray
    ) -> Optional[List[Tuple[float, float, float]]]:
        """
        Run MediaPipe PoseLandmarker (Tasks API) on a person crop.
        Returns list of 33 normalized (x, y, visibility) tuples, or None.
        """
        try:
            rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = self._landmarker.detect(mp_image)

            if not result.pose_landmarks:
                return None

            # Use the first detected pose (there should only be one per crop)
            landmarks = result.pose_landmarks[0]
            return [
                (lm.x, lm.y, lm.visibility if lm.visibility is not None else 0.0)
                for lm in landmarks
            ]
        except Exception as e:
            log.debug(f"[pose] Keypoint error: {e}")
            return None

    @staticmethod
    def _split_torso(
        crop: np.ndarray,
    ) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
        """
        Split bounding box vertically:
          upper: 15–55% of height (shoulders/chest, avoids face)
          lower: 55–85% of height (hips/legs, avoids feet)
        """
        h = crop.shape[0]
        if h < 20:
            return None, None
        upper = crop[int(h * 0.15):int(h * 0.55)]
        lower = crop[int(h * 0.55):int(h * 0.85)]
        upper = upper if upper.size > 0 else None
        lower = lower if lower.size > 0 else None
        return upper, lower

    def close(self) -> None:
        self._landmarker.close()
