"""The fixed label set for CAD layers, and the rules for trusting a label.

The list is frozen: training data is collected against it, so adding,
removing or renaming a label later means relabeling every venue. Order is the
order shown in the editor's dropdown. What each label means (and examples)
lives in prompt.py, next to the prompts that use it.
"""

from __future__ import annotations

import math
from typing import Any, Final

LABELS: Final[tuple[str, ...]] = (
    "wall",
    "door",
    "window",
    "stairs",
    "elevator",
    "restroom",
    "room",
    "walkable",
    "vegetation",
    "furniture",
    "text",
    "dimension",
    "ignore",
    "unknown",
)

LABEL_SET: Final[frozenset[str]] = frozenset(LABELS)

#: Below this confidence a layer is flagged (highlighted) for the admin.
REVIEW_THRESHOLD: Final[float] = 0.7

#: THE review gate. While True, the admin must confirm every layer before
#: "Create venue" is enabled, and confidence only orders the list (lowest
#: first). Set to False once accuracy has been measured on real venues: then
#: only flagged layers (needs_review) must be confirmed.
CONFIRM_ALL_LAYERS: Final[bool] = True

#: Labels that always need an explicit confirmation, whatever the threshold:
#: mistakes here silently drop geometry (ignore), steer routing hints
#: (walkable), or mean the model had no answer (unknown).
ALWAYS_CONFIRM: Final[frozenset[str]] = frozenset({"ignore", "walkable", "unknown"})


def validate_label(value: Any) -> str:
    """Returns the label if it is one of LABELS (case and spaces ignored), else "unknown"."""
    if not isinstance(value, str):
        return "unknown"
    label = value.strip().lower()
    return label if label in LABEL_SET else "unknown"


def clamp_confidence(value: Any) -> float:
    """A confidence in [0, 1]; anything unusable (missing, text, NaN) counts as 0."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    number = float(value)
    if math.isnan(number):
        return 0.0
    return min(1.0, max(0.0, number))


def needs_review(label: str, confidence: float | None) -> bool:
    """Flag a layer: a label that always needs a look, or a confidence that is low or missing."""
    return label in ALWAYS_CONFIRM or confidence is None or confidence < REVIEW_THRESHOLD


def must_confirm(flagged: bool) -> bool:
    """Whether "Create venue" waits for the admin to confirm this layer."""
    return CONFIRM_ALL_LAYERS or flagged
