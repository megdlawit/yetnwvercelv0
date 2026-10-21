import math

import pytest

from yetnew_layers import labels
from yetnew_layers.labels import ALWAYS_CONFIRM, LABELS, REVIEW_THRESHOLD, clamp_confidence, must_confirm, needs_review, validate_label


def test_label_list_is_frozen() -> None:
    # Changing this list means relabeling all collected data — update deliberately.
    assert LABELS == (
        "wall", "door", "window", "stairs", "elevator", "restroom", "room", "walkable",
        "vegetation", "furniture", "text", "dimension", "ignore", "unknown",
    )


def test_valid_labels_pass_case_and_spaces_ignored() -> None:
    assert validate_label("wall") == "wall"
    assert validate_label("  Door ") == "door"
    assert validate_label("VEGETATION") == "vegetation"


def test_invalid_or_missing_labels_become_unknown() -> None:
    for bad in ["walls", "tree", "", "wall, door", None, 3, ["wall"], {"label": "wall"}]:
        assert validate_label(bad) == "unknown"


def test_confidence_is_clamped_and_garbage_is_zero() -> None:
    assert clamp_confidence(0.85) == 0.85
    assert clamp_confidence(1.7) == 1.0
    assert clamp_confidence(-2) == 0.0
    assert clamp_confidence("0.9") == 0.0
    assert clamp_confidence(None) == 0.0
    assert clamp_confidence(True) == 0.0
    assert clamp_confidence(math.nan) == 0.0


def test_needs_review_rules() -> None:
    assert needs_review("unknown", 0.99)
    assert needs_review("wall", REVIEW_THRESHOLD - 0.01)
    assert needs_review("wall", None)  # no usable confidence
    assert not needs_review("wall", REVIEW_THRESHOLD)
    assert not needs_review("door", 0.95)


def test_ignore_walkable_unknown_are_always_flagged() -> None:
    assert ALWAYS_CONFIRM == {"ignore", "walkable", "unknown"}
    for label in ALWAYS_CONFIRM:
        assert needs_review(label, 1.0)


def test_gate_confirms_every_layer_for_now(monkeypatch: pytest.MonkeyPatch) -> None:
    assert labels.CONFIRM_ALL_LAYERS is True
    assert must_confirm(False) and must_confirm(True)
    # Relaxed later: only flagged layers then.
    monkeypatch.setattr(labels, "CONFIRM_ALL_LAYERS", False)
    assert not must_confirm(False) and must_confirm(True)
