"""Dataset export: legal gate, filtering, synthetic refusal, frozen whole-venue split,
augmentation, example bank, counts."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from yetnew_layers import dataset, prompt
from yetnew_layers.dataset import (
    CONSENT_NOTICE_VERSION,
    LEGAL_REVIEW_ENV,
    MIN_VENUES,
    DatasetError,
    assign_splits,
    build_dataset,
    clean_rows,
    empty_registry,
    write_dataset,
)
from yetnew_layers.prompt import layer_messages

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def legal_review_done(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(LEGAL_REVIEW_ENV, str(CONSENT_NOTICE_VERSION))


def row(venue: str, layer: str, label: str, *, via: str | None = "individual", at: str = "2026-10-10T10:00:00Z",
        file_name: str = "plan.dxf", texts: list[str] | None = None) -> dict[str, Any]:
    return {
        "building_id": venue, "layer_name": layer, "final_label": label, "confirmed_via": via, "created_at": at,
        "file_name": file_name, "layer_summary": {"name": layer, "total": 3, "entity_counts": {"LINE": 3}, "blocks": [], "texts": texts or []},
    }


def venues(ids: list[str] | int, layers: tuple[tuple[str, str], ...] = (("A-WALL", "wall"), ("A-DOOR", "door"), ("GRID", "ignore"))) -> list[dict[str, Any]]:
    names = [f"venue-{v}" for v in range(ids)] if isinstance(ids, int) else ids
    return [row(v, name, label) for v in names for name, label in layers]


# ── Legal review gate ────────────────────────────────────────────────────────

def test_customer_export_is_disabled_until_legal_review(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(LEGAL_REVIEW_ENV)
    with pytest.raises(DatasetError, match="legal review"):
        build_dataset(venues(4))
    monkeypatch.setenv(LEGAL_REVIEW_ENV, "yes")          # must name the reviewed notice version
    with pytest.raises(DatasetError, match="legal review"):
        build_dataset(venues(4))
    monkeypatch.setenv(LEGAL_REVIEW_ENV, str(CONSENT_NOTICE_VERSION))
    build_dataset(venues(4))


def test_notice_version_matches_the_editor() -> None:
    ts = (REPO / "src" / "lib" / "cad" / "layerLabels" / "consent.ts").read_text(encoding="utf-8")
    assert int(re.search(r"TRAINING_NOTICE_VERSION = (\d+)", ts).group(1)) == CONSENT_NOTICE_VERSION  # type: ignore[union-attr]


def test_synthetic_dry_run_needs_no_legal_review(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(LEGAL_REVIEW_ENV)
    rows = [row(f"s{i}", "A-WALL", "wall", file_name="SYNTHETIC_plan.dxf") for i in range(3)]
    assert build_dataset(rows, allow_synthetic=True).synthetic is True


# ── Filtering ────────────────────────────────────────────────────────────────

def test_only_individual_and_group_confirmations_with_real_labels() -> None:
    examples, dropped = clean_rows([
        row("v", "A", "wall", via="individual"), row("v", "B", "door", via="group"),
        row("v", "C", "wall", via="bulk"), row("v", "D", "wall", via=None),
        row("v", "E", "unknown"), row("v", "F", "walls"),
    ])
    assert sorted(e.layer_name for e in examples) == ["A", "B"]
    assert dropped == {"not confirmed individually or by group": 2, "label missing, unknown or not in the list": 2}


def test_latest_confirmation_of_a_layer_wins() -> None:
    examples, dropped = clean_rows([
        row("v", "A-WALL", "door", at="2026-10-01T00:00:00Z"),
        row("v", "a-wall", "wall", at="2026-10-05T00:00:00Z"),   # same layer, re-imported and corrected
        row("v", "A-WALL", "window", at="2026-10-03T00:00:00Z"),
    ])
    assert [(e.layer_name, e.label) for e in examples] == [("a-wall", "wall")]
    assert dropped["older confirmation of the same layer"] == 2


def test_synthetic_rows_are_refused() -> None:
    rows = venues(4) + [row("venue-9", "X", "wall", file_name="SYNTHETIC_architect_plan.dxf")]
    with pytest.raises(DatasetError, match="SYNTHETIC"):
        build_dataset(rows)
    assert build_dataset(rows, allow_synthetic=True).synthetic is True


def test_fewer_than_three_venues_is_refused() -> None:
    assert MIN_VENUES == 3
    with pytest.raises(DatasetError, match="at least 3"):
        build_dataset(venues(2))
    build_dataset(venues(3))


# ── Frozen whole-venue split ─────────────────────────────────────────────────

def test_split_is_by_whole_venue() -> None:
    ds = build_dataset(venues(10), augment_copies=0)
    assert set(ds.train_venues).isdisjoint(ds.val_venues)
    assert len(ds.val_venues) == 2 and len(ds.train_venues) == 8
    assert {e.building_id for e in ds.val} == set(ds.val_venues)
    assert {e.building_id for e in ds.train} == set(ds.train_venues)


def test_held_out_venues_are_frozen_across_exports() -> None:
    first = build_dataset(venues(10))
    # Later: 15 new venues arrive, and one venue's consent was revoked (its rows are gone).
    gone = first.train_venues[0]
    later_ids = [v for v in (f"venue-{i}" for i in range(25)) if v != gone]
    later = build_dataset(venues(later_ids), registry=first.registry)

    for v in first.val_venues:                       # held out once, held out forever
        assert v in later.val_venues
    for v in first.train_venues:                     # trained on once, never validation
        assert v not in later.val_venues
    assert gone in later.registry["venues"]          # the registry only grows
    assert set(first.registry["venues"]) <= set(later.registry["venues"])
    assert all(later.registry["venues"][v] == first.registry["venues"][v] for v in first.registry["venues"])
    assert len([v for v in later.registry["venues"].values() if v["split"] == "val"]) == 5   # ~20% of 25


def test_new_venues_do_not_reshuffle_with_a_different_seed() -> None:
    first = build_dataset(venues(10))
    again = build_dataset(venues(10), registry=first.registry, seed="something else")
    assert (again.train_venues, again.val_venues) == (first.train_venues, first.val_venues)


def test_an_export_needs_both_splits_present() -> None:
    # An export whose venues are all recorded as held out (e.g. the others revoked consent).
    _, val, reg = assign_splits(["a", "b", "c"], empty_registry())
    reg["venues"].update({"d": {"split": "val"}, "e": {"split": "val"}})
    with pytest.raises(DatasetError, match="both are needed"):
        assign_splits([val[0], "d", "e"], reg)


# ── Augmentation, texts, files ───────────────────────────────────────────────

def test_augmentation_only_touches_the_training_set() -> None:
    ds = build_dataset(venues(5), augment_copies=1)
    assert any(e.augmented for e in ds.train)
    assert not any(e.augmented for e in ds.val)
    aug = next(e for e in ds.train if e.augmented)
    assert aug.summary["name"] == aug.layer_name and aug.label in {"wall", "door", "ignore"}


def test_text_samples_follow_the_shared_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [row(f"v{i}", "A-ROOM-NAME", "text", texts=["Lobby"]) for i in range(3)]
    assert all(e.summary["texts"] == [] for e in clean_rows(rows)[0])
    monkeypatch.setattr(dataset, "INCLUDE_TEXT_SAMPLES", True)
    monkeypatch.setattr(prompt, "INCLUDE_TEXT_SAMPLES", True)
    assert all(e.summary["texts"] == ["Lobby"] for e in clean_rows(rows)[0])


def test_written_files_counts_warnings_and_example_bank(tmp_path: Path) -> None:
    ds = build_dataset(venues(5), augment_copies=1)
    manifest = write_dataset(ds, tmp_path)
    train = [json.loads(line) for line in (tmp_path / "train.jsonl").read_text(encoding="utf-8").splitlines()]
    val_layers = [json.loads(line) for line in (tmp_path / "val_layers.jsonl").read_text(encoding="utf-8").splitlines()]
    bank = [json.loads(line) for line in (tmp_path / "example_bank.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(train) == manifest["examples"]["train"]
    assert len(val_layers) == manifest["examples"]["val"] == 3
    # The retrieval bank: training venues only, no augmented spellings.
    assert {b["building_id"] for b in bank} == set(ds.train_venues)
    assert len(bank) == 3 * len(ds.train_venues)
    # A training row is exactly the inference prompt plus the answer.
    first = train[0]
    name = json.loads(first["messages"][1]["content"])["layer"]
    assert first["messages"][:2] == layer_messages({"name": name, "entity_counts": {"LINE": 3}, "blocks": [], "texts": []})
    assert first["messages"][2] == {"role": "assistant", "content": first["label"]}
    assert manifest["label_counts"]["val"] == {**{k: 0 for k in manifest["label_counts"]["val"]}, "wall": 1, "door": 1, "ignore": 1}
    assert manifest["synthetic"] is False and manifest["prompt_version"] == prompt.PROMPT_VERSION
    assert any("aim for 15" in w for w in manifest["warnings"])
    assert any("Fewer than 20 examples" in w for w in manifest["warnings"])


def test_synthetic_fixture_export_runs_as_a_marked_dry_run(tmp_path: Path) -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location("mse", Path(__file__).parent / "fixtures" / "make_synthetic_export.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rows = mod.make_rows()
    with pytest.raises(DatasetError):
        build_dataset(rows)
    manifest = write_dataset(build_dataset(rows, allow_synthetic=True), tmp_path)
    assert manifest["synthetic"] is True
    assert len(manifest["venues"]["val"]) == 1 and len(manifest["venues"]["train"]) == 4


def test_generic_name_copies_keep_content_and_label_and_stay_in_training() -> None:
    plain = build_dataset(venues(5), augment_copies=0)
    ds = build_dataset(venues(5), augment_copies=0, generic_name_copies=2)
    copies = [e for e in ds.train if e.augmented]
    assert len(copies) == 2 * len(plain.train)
    originals = {(e.building_id, e.label, tuple(e.summary["entity_counts"].items())) for e in plain.train}
    for c in copies:
        assert c.summary["name"] == c.layer_name
        assert re.fullmatch(r"Layer \d+|0|New Layer|Layer\d+|layer_\d+|Untitled \d+", c.layer_name)
        assert (c.building_id, c.label, tuple(c.summary["entity_counts"].items())) in originals
    assert not any(e.augmented for e in ds.val)
    assert build_dataset(venues(5), augment_copies=0, generic_name_copies=2).train[-1].layer_name == copies[-1].layer_name  # deterministic
