"""Hand-labeled test sets ("gold") for measuring the labeler on real drawings.

A gold file is a spreadsheet-friendly CSV per drawing (ml/data/gold/<drawing>.csv):

    layer_name, entity_count, entity_type_summary, block_names, text_samples, my_label

Everything but my_label is filled from the drawing; my_label is left EMPTY for
a person to fill in by hand, so the answers never come from the model.
gold/files.json maps each CSV to its drawing. Test files only — never
training data (see data/SOURCES.md for each file's source and license).

score() compares the baseline's answers with my_label: accuracy by layer and
weighted by entity count, per label, per file, every wrong layer, confidence
on right vs wrong answers, and flags for the mistakes that hurt a map most.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .labels import LABEL_SET, LABELS

COLUMNS = ["layer_name", "entity_count", "entity_type_summary", "block_names", "text_samples", "my_label"]
#: Mistakes on these labels hurt the map most (lost walls, wrong routing, dropped geometry).
CRITICAL_LABELS = ("wall", "walkable", "ignore")
#: A layer this big (or this share of the drawing's entities) is flagged when wrong.
BIG_LAYER_ENTITIES = 100
BIG_LAYER_SHARE = 0.05


class GoldError(ValueError):
    """A gold CSV is malformed, or has labels outside the list."""


@dataclass
class GoldRow:
    layer_name: str
    entity_count: int
    label: str | None  # None = not labeled yet


@dataclass
class GoldFile:
    name: str
    rows: list[GoldRow]

    @property
    def missing(self) -> list[str]:
        return [r.layer_name for r in self.rows if r.label is None]


def gold_rows(summaries: list[dict[str, Any]]) -> list[dict[str, str]]:
    """The CSV rows for a drawing's layer summaries — my_label left empty on purpose."""
    return [{
        "layer_name": str(s["name"]),
        "entity_count": str(int(s.get("total", 0))),
        "entity_type_summary": "; ".join(f"{t} {n}" for t, n in dict(s.get("entity_counts") or {}).items()),
        "block_names": "; ".join(str(b) for b in s.get("blocks") or []),
        "text_samples": "; ".join(str(t) for t in s.get("texts") or []),
        "my_label": "",
    } for s in summaries]


def write_gold_csv(summaries: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig: Excel opens it with the right characters.
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(gold_rows(summaries))


def load_gold_csv(path: Path) -> GoldFile:
    """Reads a filled-in gold CSV. Labels are case- and space-insensitive; empty = not labeled yet.
    Raises GoldError for a wrong header, duplicate layers, bad counts or labels outside the list."""
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        header = [h.strip() for h in reader.fieldnames or []]
        if header != COLUMNS:
            raise GoldError(f"{path.name}: the columns must be {', '.join(COLUMNS)} (found {', '.join(header) or 'none'})")
        rows: list[GoldRow] = []
        problems: list[str] = []
        seen: set[str] = set()
        for line, raw in enumerate(reader, start=2):
            name = (raw.get("layer_name") or "").strip()
            if not name:
                problems.append(f"line {line}: empty layer_name")
                continue
            if name in seen:
                problems.append(f"line {line}: layer {name!r} appears twice")
            seen.add(name)
            try:
                count = int((raw.get("entity_count") or "0").strip())
            except ValueError:
                problems.append(f"line {line}: entity_count {raw.get('entity_count')!r} is not a number")
                count = 0
            label = (raw.get("my_label") or "").strip().lower() or None
            if label is not None and label not in LABEL_SET:
                problems.append(f"line {line}: {name!r} has label {label!r}, which is not one of: {', '.join(LABELS)}")
            rows.append(GoldRow(name, count, label))
    if problems:
        raise GoldError(f"{path.name}:\n  " + "\n  ".join(problems))
    return GoldFile(path.stem, rows)


# ── Scoring ──────────────────────────────────────────────────────────────────

@dataclass
class Scored:
    file: str
    layer: str
    entities: int
    gold: str
    predicted: str
    confidence: float | None

    @property
    def right(self) -> bool:
        return self.gold == self.predicted


@dataclass
class GoldReport:
    files: int
    layers: int
    entities: int
    accuracy_by_layer: float
    accuracy_by_entities: float
    per_label: dict[str, dict[str, float]]
    per_file: dict[str, dict[str, float]]
    wrong: list[dict[str, Any]]
    confidence: dict[str, float | None]
    flags: list[dict[str, Any]]
    caveat: str
    notes: list[str] = field(default_factory=list)


def _acc(items: list[Scored], weighted: bool = False) -> float:
    if not items:
        return 0.0
    if weighted:
        total = sum(s.entities for s in items)
        return round(sum(s.entities for s in items if s.right) / total, 4) if total else 0.0
    return round(sum(s.right for s in items) / len(items), 4)


def _mean(xs: list[float]) -> float | None:
    return round(sum(xs) / len(xs), 3) if xs else None


def score(items: list[Scored]) -> GoldReport:
    files = sorted({s.file for s in items})
    file_entities = {f: sum(s.entities for s in items if s.file == f) for f in files}
    per_label = {}
    for label in LABELS:
        group = [s for s in items if s.gold == label]
        if group:
            per_label[label] = {"layers": len(group), "accuracy": _acc(group), "entities": sum(s.entities for s in group),
                                "accuracy_by_entities": _acc(group, weighted=True)}
    per_file = {f: {"layers": len(g), "accuracy": _acc(g), "accuracy_by_entities": _acc(g, weighted=True)}
                for f in files if (g := [s for s in items if s.file == f])}
    wrong = sorted((s for s in items if not s.right), key=lambda s: (-s.entities, s.file, s.layer))
    flags = []
    for s in wrong:
        why = []
        if s.gold in CRITICAL_LABELS or s.predicted in CRITICAL_LABELS:
            why.append(f"involves {s.gold if s.gold in CRITICAL_LABELS else s.predicted}")
        if s.entities >= BIG_LAYER_ENTITIES or (file_entities[s.file] and s.entities / file_entities[s.file] >= BIG_LAYER_SHARE):
            why.append(f"big layer ({s.entities} entities, {s.entities / max(1, file_entities[s.file]):.0%} of the drawing)")
        if why:
            flags.append({"file": s.file, "layer": s.layer, "gold": s.gold, "predicted": s.predicted, "entities": s.entities, "why": why})
    conf_right = [s.confidence for s in items if s.right and s.confidence is not None]
    conf_wrong = [s.confidence for s in items if not s.right and s.confidence is not None]
    n_layers = len(items)
    caveat = (f"Measured on {len(files)} file(s) and {n_layers} labeled layer(s). "
              + ("That is far too little to judge the labeler: one drawing's conventions dominate. "
                 "Treat these numbers as a first look, not an accuracy." if len(files) < 3 or n_layers < 100 else
                 "Still a small sample — differences of a few points are noise."))
    return GoldReport(
        files=len(files), layers=n_layers, entities=sum(s.entities for s in items),
        accuracy_by_layer=_acc(items), accuracy_by_entities=_acc(items, weighted=True),
        per_label=per_label, per_file=per_file,
        wrong=[{"file": s.file, "layer": s.layer, "entities": s.entities, "gold": s.gold, "predicted": s.predicted,
                "confidence": s.confidence} for s in wrong],
        confidence={"right_mean": _mean(conf_right), "wrong_mean": _mean(conf_wrong),
                    "wrong_lower": (None if not conf_right or not conf_wrong else _mean(conf_wrong) < _mean(conf_right))},  # type: ignore[operator]
        flags=flags, caveat=caveat,
    )


def load_files_map(gold_dir: Path) -> dict[str, str]:
    path = gold_dir / "files.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
