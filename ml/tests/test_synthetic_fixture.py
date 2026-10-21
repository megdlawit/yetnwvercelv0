"""The SYNTHETIC fixture stays what it claims to be: every expected layer is
present, its labels are valid, and it is marked as not-for-training."""

import json
from pathlib import Path

import ezdxf

from yetnew_layers.labels import LABEL_SET
from yetnew_layers.summarize import summarize_file

FIXTURES = Path(__file__).parent / "fixtures"
DXF = FIXTURES / "SYNTHETIC_architect_plan.dxf"
EXPECTED = json.loads((FIXTURES / "SYNTHETIC_expected_labels.json").read_text())


def test_fixture_is_marked_synthetic_and_do_not_train() -> None:
    assert EXPECTED["synthetic"] is True and EXPECTED["do_not_train"] is True
    assert "SYNTHETIC" in DXF.name
    assert "DO NOT TRAIN" in ezdxf.readfile(DXF).header["$PROJECTNAME"]


def test_every_expected_layer_is_in_the_drawing_with_a_valid_label() -> None:
    layers = {s["name"] for s in summarize_file(DXF)}
    assert set(EXPECTED["labels"]) == layers
    assert set(EXPECTED["labels"].values()) <= LABEL_SET


def test_layers_carry_the_signals_real_files_have() -> None:
    by = {s["name"]: s for s in summarize_file(DXF)}
    assert by["A-DOOR"]["blocks"] == ["DOOR-SGL-900"]
    assert by["A-ANNO-DIMS"]["entity_counts"] == {"DIMENSION": 3}
    assert "Gallery" in by["A-AREA-IDEN"]["texts"]  # room-tag attribute values are read
    assert by["WC"]["texts"] == ["WC"]
