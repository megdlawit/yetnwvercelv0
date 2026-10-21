"""Gold CSVs: format, empty labels, invalid labels, and the scoring metrics."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from yetnew_layers.gold import COLUMNS, GoldError, Scored, load_gold_csv, score, write_gold_csv

SUMMARIES = [
    {"name": "A-WALL", "total": 800, "entity_counts": {"LINE": 780, "LWPOLYLINE": 20}, "blocks": [], "texts": []},
    {"name": "A-DOOR", "total": 40, "entity_counts": {"INSERT": 40}, "blocks": ["DR-900", "DR-800"], "texts": []},
    {"name": "A-ANNO", "total": 12, "entity_counts": {"TEXT": 12}, "blocks": [], "texts": ["Lobby", "Café, 1st"]},
    {"name": "TITLE", "total": 0, "entity_counts": {}, "blocks": [], "texts": []},
]


def written(tmp_path: Path) -> Path:
    path = tmp_path / "plan.csv"
    write_gold_csv(SUMMARIES, path)
    return path


def fill(path: Path, labels: dict[str, str]) -> None:
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["my_label"] = labels.get(r["layer_name"], r["my_label"])
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)


def test_written_csv_has_the_columns_and_no_labels(tmp_path: Path) -> None:
    path = written(tmp_path)
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == COLUMNS
    assert [r["my_label"] for r in rows] == ["", "", "", ""]          # never pre-filled with AI output
    assert rows[0]["entity_type_summary"] == "LINE 780; LWPOLYLINE 20"
    assert rows[1]["block_names"] == "DR-900; DR-800"
    assert rows[2]["text_samples"] == "Lobby; Café, 1st"              # commas inside a cell survive
    gold = load_gold_csv(path)
    assert gold.missing == ["A-WALL", "A-DOOR", "A-ANNO", "TITLE"]


def test_labels_are_read_case_insensitively(tmp_path: Path) -> None:
    path = written(tmp_path)
    fill(path, {"A-WALL": " Wall ", "A-DOOR": "door", "A-ANNO": "TEXT", "TITLE": "ignore"})
    gold = load_gold_csv(path)
    assert [r.label for r in gold.rows] == ["wall", "door", "text", "ignore"]
    assert gold.missing == [] and gold.rows[0].entity_count == 800


def test_invalid_labels_are_reported_with_line_numbers(tmp_path: Path) -> None:
    path = written(tmp_path)
    fill(path, {"A-WALL": "walls", "A-DOOR": "door", "A-ANNO": "label"})
    with pytest.raises(GoldError) as err:
        load_gold_csv(path)
    msg = str(err.value)
    assert "line 2: 'A-WALL' has label 'walls'" in msg and "line 4: 'A-ANNO' has label 'label'" in msg
    assert "A-DOOR" not in msg


def test_wrong_columns_and_duplicates_are_refused(tmp_path: Path) -> None:
    bad = tmp_path / "bad.csv"
    bad.write_text("layer,label\nA-WALL,wall\n", encoding="utf-8")
    with pytest.raises(GoldError, match="columns must be"):
        load_gold_csv(bad)
    dup = written(tmp_path)
    with dup.open("a", encoding="utf-8", newline="") as f:
        csv.writer(f).writerow(["A-WALL", "1", "", "", "", "wall"])
    with pytest.raises(GoldError, match="appears twice"):
        load_gold_csv(dup)


def test_score_reports_by_layer_by_entity_per_label_and_flags() -> None:
    items = [
        Scored("plan", "A-WALL", 800, "wall", "wall", 0.99),
        Scored("plan", "A-WALL-2", 300, "wall", "ignore", 0.60),     # big + critical
        Scored("plan", "A-DOOR", 40, "door", "door", 0.95),
        Scored("plan", "A-ANNO", 12, "text", "room", 0.40),          # small, not critical
        Scored("plan", "TITLE", 0, "ignore", "ignore", 0.90),
        Scored("other", "WALK", 20, "walkable", "wall", 0.50),       # critical, small
    ]
    r = score(items)
    assert (r.files, r.layers, r.entities) == (2, 6, 1172)
    assert r.accuracy_by_layer == 0.5
    assert r.accuracy_by_entities == round(840 / 1172, 4)
    assert r.per_label["wall"] == {"layers": 2, "accuracy": 0.5, "entities": 1100, "accuracy_by_entities": round(800 / 1100, 4)}
    assert r.per_file["other"]["accuracy"] == 0.0
    assert [w["layer"] for w in r.wrong] == ["A-WALL-2", "WALK", "A-ANNO"]           # biggest first
    flagged = {f["layer"]: f["why"] for f in r.flags}
    assert set(flagged) == {"A-WALL-2", "WALK"}
    assert any("big layer" in w for w in flagged["A-WALL-2"]) and any("involves wall" in w for w in flagged["A-WALL-2"])
    assert any("involves walkable" in w for w in flagged["WALK"])                    # 20 of 20 entities = big share too
    assert r.confidence["wrong_lower"] is True and r.confidence["wrong_mean"] == 0.5
    assert "2 file(s) and 6 labeled layer(s)" in r.caveat and "far too little" in r.caveat
