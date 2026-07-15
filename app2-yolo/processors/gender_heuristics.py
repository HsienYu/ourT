"""
gender_heuristics.py

Rule-based gender-expression scoring from pose keypoints and clothing color.
Intentionally imprecise — the instability of the label IS the artistic intent.

Score: 0 = strongly masculine-coded, 100 = strongly feminine-coded, 50 = neutral.

Heuristics used:
  1. Shoulder-to-hip width ratio (from MediaPipe keypoints)
     - Wider shoulders relative to hips → lower score (masculine silhouette)
     - Wider hips relative to shoulders → higher score (feminine silhouette)
  2. Dominant clothing color (HSV analysis on upper vs lower torso crop)
     - Warm/saturated pinks/reds → higher score
     - Cool blues/greens/grays → lower score
     - Neutral/black/white → no strong push

The global bias parameter (from the operator panel) shifts the final score,
enabling the operator to push all labels toward one end during the performance.

Oscillation mode: bias drifts sinusoidally, making labels flicker over time.
"""

from __future__ import annotations
import math
import random
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from .yolo_detector import PersonDetection


@dataclass
class GenderScore:
    raw: float           # 0–100 before bias
    final: float         # 0–100 after bias + jitter
    label: str           # 男性化 / 女性化 / 中性 / 不確定性
    shoulder_hip_ratio: Optional[float]
    dominant_upper_color: Optional[Tuple[int, int, int]]  # HSV
    dominant_lower_color: Optional[Tuple[int, int, int]]  # HSV


class GenderHeuristics:
    # MediaPipe keypoint indices
    _KP_L_SHOULDER = 11
    _KP_R_SHOULDER = 12
    _KP_L_HIP      = 23
    _KP_R_HIP      = 24

    def __init__(self, cfg: dict):
        self._cfg = cfg
        self._labels = cfg.get("labels", {
            "masc": "男性化", "fem": "女性化",
            "neutral": "中性", "fluid": "不確定性",
        })
        self._thresh_masc  = cfg.get("threshold_masc", 35)
        self._thresh_fem   = cfg.get("threshold_fem", 65)
        self._fluid_band   = cfg.get("threshold_fluid_band", 8)
        self._start_time   = time.time()
        self._role_by_track_id: Dict[int, str] = {}

    # ── Public API ────────────────────────────────────────────────────────────

    def score(self, person: PersonDetection) -> GenderScore:
        """Compute gender-expression score for a detected person."""
        silhouette_score = self._silhouette_score(person.keypoints)
        color_score, upper_hsv, lower_hsv = self._color_score(
            person.upper_crop, person.lower_crop
        )

        # Blend: silhouette 60%, color 40% (silhouette is more reliable)
        if silhouette_score is not None and color_score is not None:
            raw = silhouette_score * 0.6 + color_score * 0.4
        elif silhouette_score is not None:
            raw = silhouette_score
        elif color_score is not None:
            raw = color_score
        else:
            raw = 50.0  # unknown → neutral

        # Apply global bias (operator slider)
        bias = self._current_bias()
        final = float(np.clip(raw + bias, 0, 100))

        # Apply per-person random jitter
        if self._cfg.get("randomize", False):
            strength = self._cfg.get("randomize_strength", 20)
            final = float(np.clip(final + random.uniform(-strength, strength), 0, 100))

        label = self._to_label(final)
        return GenderScore(
            raw=round(raw, 1),
            final=round(final, 1),
            label=label,
            shoulder_hip_ratio=self._last_shr,
            dominant_upper_color=upper_hsv,
            dominant_lower_color=lower_hsv,
        )

    def update_config(self, cfg: dict) -> None:
        """Keep one instance alive so oscillation and role projections stay stable."""
        self._cfg = cfg
        self._labels = cfg.get("labels", self._labels)
        self._thresh_masc = cfg.get("threshold_masc", self._thresh_masc)
        self._thresh_fem = cfg.get("threshold_fem", self._thresh_fem)
        self._fluid_band = cfg.get("threshold_fluid_band", self._fluid_band)

    def social_labels(
        self,
        person: PersonDetection,
        frame_height: int,
    ) -> Dict[str, str]:
        """
        Return performance labels, not claims about a person's actual identity.

        Height, pose and clothing colour are visual observations. Occupation is
        deliberately labelled as a social projection and remains stable per
        tracker ID. Skin tone is intentionally not inferred from camera data;
        the displayed light tone describes the image lighting instead.
        """
        x1, y1, x2, y2 = person.bbox
        bbox_height = y2 - y1
        height_ratio = bbox_height / max(frame_height, 1)
        height = "高" if height_ratio > 0.7 else "中" if height_ratio > 0.45 else "矮"

        clothing_hsv = self._dominant_hsv(person.upper_crop)
        clothing = self._color_name(clothing_hsv)
        light_tone = self._light_tone(clothing_hsv)
        posture = self._posture(person.keypoints)
        role = self._role_projection(person.track_id, clothing_hsv, posture)

        return {
            "height": height,
            "clothing_colour": clothing,
            "image_light": light_tone,
            "skin_tone": "不判定",
            "posture": posture,
            "role_projection": role,
        }

    # ── Bias ─────────────────────────────────────────────────────────────────

    def _current_bias(self) -> float:
        base_bias = float(self._cfg.get("bias", 0))
        if not self._cfg.get("oscillation", False):
            return base_bias
        period = self._cfg.get("oscillation_period_s", 30)
        amplitude = self._cfg.get("oscillation_amplitude", 40)
        t = time.time() - self._start_time
        oscillation = amplitude * math.sin(2 * math.pi * t / period)
        return base_bias + oscillation

    # ── Silhouette heuristic ──────────────────────────────────────────────────

    _last_shr: Optional[float] = None

    def _silhouette_score(
        self, keypoints: Optional[List[Tuple[float, float, float]]]
    ) -> Optional[float]:
        """
        Shoulder-to-hip ratio → score.
        ratio > 1.15 = wide shoulders (masculine) → low score
        ratio < 0.85 = wide hips (feminine) → high score
        ratio ≈ 1.0  = neutral
        """
        if keypoints is None or len(keypoints) < 25:
            self._last_shr = None
            return None

        ls = keypoints[self._KP_L_SHOULDER]
        rs = keypoints[self._KP_R_SHOULDER]
        lh = keypoints[self._KP_L_HIP]
        rh = keypoints[self._KP_R_HIP]

        # Only use if all four keypoints are reasonably visible
        if any(kp[2] < 0.4 for kp in [ls, rs, lh, rh]):
            self._last_shr = None
            return None

        shoulder_width = abs(ls[0] - rs[0])
        hip_width      = abs(lh[0] - rh[0])

        if hip_width < 0.01:
            self._last_shr = None
            return None

        ratio = shoulder_width / hip_width
        self._last_shr = round(ratio, 3)

        # Map ratio to 0–100 score
        # ratio 1.4+ → 5 (very masculine)
        # ratio 1.0  → 50 (neutral)
        # ratio 0.6- → 95 (very feminine)
        score = 50.0 - (ratio - 1.0) * 120.0
        return float(np.clip(score, 0, 100))

    # ── Color heuristic ───────────────────────────────────────────────────────

    def _color_score(
        self,
        upper: Optional[np.ndarray],
        lower: Optional[np.ndarray],
    ) -> Tuple[Optional[float], Optional[Tuple], Optional[Tuple]]:
        """
        Analyze dominant HSV color of upper and lower torso crops.
        Returns (score, upper_hsv, lower_hsv).
        """
        upper_hsv = self._dominant_hsv(upper)
        lower_hsv = self._dominant_hsv(lower)

        scores = []
        if upper_hsv:
            scores.append(self._hsv_to_gender_score(upper_hsv))
        if lower_hsv:
            scores.append(self._hsv_to_gender_score(lower_hsv))

        if not scores:
            return None, upper_hsv, lower_hsv
        return float(np.mean(scores)), upper_hsv, lower_hsv

    @staticmethod
    def _dominant_hsv(
        crop: Optional[np.ndarray], k: int = 3
    ) -> Optional[Tuple[int, int, int]]:
        """K-means on HSV to find dominant color. Returns (H, S, V)."""
        if crop is None or crop.size == 0:
            return None
        try:
            hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
            pixels = hsv.reshape(-1, 3).astype(np.float32)
            if len(pixels) < k:
                return None
            criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
            _, labels, centers = cv2.kmeans(
                pixels, k, None, criteria, 3, cv2.KMEANS_RANDOM_CENTERS
            )
            # Pick cluster with most pixels
            counts = np.bincount(labels.flatten())
            dominant = centers[np.argmax(counts)]
            return (int(dominant[0]), int(dominant[1]), int(dominant[2]))
        except Exception:
            return None

    @staticmethod
    def _hsv_to_gender_score(hsv: Tuple[int, int, int]) -> float:
        """
        Map HSV color to a gender-expression score bias.
        H: 0–179 in OpenCV (0=red, 30=yellow, 60=green, 120=blue, 150=magenta)
        S: saturation 0–255
        V: value/brightness 0–255

        Heuristics:
          - Pink/red/magenta (H 0–10 or 150–179) + high saturation → feminine
          - Blue/navy (H 100–130) + high saturation → masculine
          - Yellow/warm (H 15–40) → slight feminine push
          - Green (H 60–90) → slight masculine push
          - Low saturation (gray/black/white) → neutral (50)
        """
        h, s, v = hsv

        if s < 40:
            return 50.0  # achromatic — no push

        # Pink/magenta/red
        if (h <= 10 or h >= 155) and s > 80:
            return 72.0 + min(s / 255 * 15, 15)

        # Warm red-orange
        if 10 < h <= 20 and s > 80:
            return 65.0

        # Yellow/warm
        if 20 < h <= 40:
            return 57.0

        # Green
        if 60 <= h <= 90:
            return 43.0

        # Cyan/teal
        if 90 < h <= 110:
            return 47.0

        # Blue
        if 110 < h <= 135 and s > 80:
            return 30.0 - min(s / 255 * 10, 10)

        # Purple/violet
        if 135 < h <= 155:
            return 60.0

        return 50.0  # fallback neutral

    # ── Label assignment ──────────────────────────────────────────────────────

    def _to_label(self, score: float) -> str:
        # Uncertainty zone: within ±fluid_band of 50
        if abs(score - 50.0) <= self._fluid_band:
            return self._labels["fluid"]
        if score <= self._thresh_masc:
            return self._labels["masc"]
        if score >= self._thresh_fem:
            return self._labels["fem"]
        return self._labels["neutral"]

    @staticmethod
    def _color_name(hsv: Optional[Tuple[int, int, int]]) -> str:
        if hsv is None:
            return "未知"
        h, s, v = hsv
        if v < 55:
            return "黑"
        if s < 35:
            return "白" if v > 185 else "灰"
        if h <= 10 or h >= 165:
            return "紅"
        if h <= 20:
            return "橙"
        if h <= 38:
            return "黃"
        if h <= 85:
            return "綠"
        if h <= 105:
            return "青"
        if h <= 135:
            return "藍"
        if h <= 165:
            return "紫"
        return "未知"

    @staticmethod
    def _light_tone(hsv: Optional[Tuple[int, int, int]]) -> str:
        if hsv is None:
            return "遮蔽"
        h, s, v = hsv
        if v < 70:
            return "低光"
        if s < 35:
            return "中性光"
        if h <= 40 or h >= 155:
            return "暖光"
        if 80 <= h <= 140:
            return "冷光"
        return "混合光"

    def _posture(self, keypoints: Optional[List[Tuple[float, float, float]]]) -> str:
        if keypoints is None or len(keypoints) < 25:
            return "未讀取"
        ls, rs = keypoints[self._KP_L_SHOULDER], keypoints[self._KP_R_SHOULDER]
        lh, rh = keypoints[self._KP_L_HIP], keypoints[self._KP_R_HIP]
        if any(kp[2] < 0.4 for kp in [ls, rs, lh, rh]):
            return "未讀取"
        shoulder_y = (ls[1] + rs[1]) / 2
        hip_y = (lh[1] + rh[1]) / 2
        return "直立" if hip_y - shoulder_y > 0.22 else "收縮"

    def _role_projection(
        self,
        track_id: Optional[int],
        hsv: Optional[Tuple[int, int, int]],
        posture: str,
    ) -> str:
        """A fictional, visibly marked social projection, never an occupation claim."""
        key = track_id if track_id is not None else -1
        if key in self._role_by_track_id:
            return self._role_by_track_id[key]
        colour = self._color_name(hsv)
        projections = {
            "黑": "夜班人員", "白": "見習者", "灰": "行政幻影",
            "紅": "煽動者", "橙": "現場工作者", "黃": "預言者",
            "綠": "照護者", "青": "系統維護者", "藍": "研究員",
            "紫": "表演者", "未知": "未分類者",
        }
        role = projections.get(colour, "未分類者")
        if posture == "收縮":
            role = "旁觀者"
        self._role_by_track_id[key] = role
        return role
