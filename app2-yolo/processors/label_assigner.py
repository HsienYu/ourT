"""Stable YAML-backed performance-label assignment for YOLO tracks."""

from __future__ import annotations

import random
from typing import Dict, Optional


class LabelAssigner:
    """Assign one configured label to each tracked person for its track lifetime."""

    def __init__(self, labels: object):
        self._labels = self._clean_labels(labels)
        self._label_by_track_id: Dict[int, str] = {}

    def assign(self, track_id: Optional[int]) -> str:
        if not self._labels:
            return ""

        key = track_id if track_id is not None else -1
        if key not in self._label_by_track_id:
            self._label_by_track_id[key] = random.choice(self._labels)
        return self._label_by_track_id[key]

    @staticmethod
    def _clean_labels(labels: object) -> list[str]:
        if not isinstance(labels, list):
            return []
        return [label.strip() for label in labels if isinstance(label, str) and label.strip()]
