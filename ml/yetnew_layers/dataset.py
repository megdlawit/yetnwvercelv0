"""Turns reviewed layer labels into a training set — with the rules that keep it honest.

Rows come from public.layer_label_training_rows() (migration 20261010110000),
which already returns only layers confirmed one by one or by group, on venues
whose training consent is accepted NOW. This module checks those rules again
and adds its own:

  * No customer data at all until the consent notice has been legally
    reviewed: YETNEW_LEGAL_REVIEWED_NOTICE_VERSION must equal
    CONSENT_NOTICE_VERSION (the notice's version in the editor). Changing the
    notice means a new review.
  * Only labels from the fixed list, never "unknown"; only confirmed_via
    individual or group.
  * Synthetic fixtures are refused (file names containing "SYNTHETIC"),
    except in an explicit dry run whose output is marked synthetic and which
    the notebook and evaluate.py refuse to train on or approve.
  * Duplicates — the same layer of the same venue imported again — keep only
    the latest confirmation.
  * The split is by WHOLE VENUE and FROZEN: heldout/venues.json records the
    split of every venue ever exported and only grows. A held-out venue stays
    held out in every later export (so it is never trained on); a training
    venue never becomes validation. New venues are held out until ~20% are.
    At least MIN_VENUES venues, or no export.
  * Augmentation (name spelling variants) is applied to the training set only.
  * Text samples follow prompt.INCLUDE_TEXT_SAMPLES, like every prompt.

Training rows are built with prompt.training_example — the same function the
service's prompt comes from — so training and inference see identical text.
The retrieval example bank comes from the training venues only.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import ML_DIR
from .labels import LABELS
from .prompt import INCLUDE_TEXT_SAMPLES, PROMPT_VERSION, training_example

MIN_VENUES = 3
VAL_FRACTION = 0.2
CONFIRMED_VIA_ALLOWED = frozenset({"individual", "group"})

#: Version of the training-consent notice shown in the editor
#: (src/lib/cad/layerLabels/consent.ts, TRAINING_NOTICE_VERSION — a test keeps them equal).
CONSENT_NOTICE_VERSION = 1
LEGAL_REVIEW_ENV = "YETNEW_LEGAL_REVIEWED_NOTICE_VERSION"

#: The frozen split of every venue ever exported (venue ids only; it only grows).
HELDOUT_FILE = ML_DIR / "heldout" / "venues.json"

# Data-quality targets (README): below these the export still runs, with warnings.
TARGET_VENUES = 15
TARGET_LAYERS = 500
TARGET_PER_LABEL = 20


class DatasetError(ValueError):
    """The rows can't make a training set (too few venues, synthetic data, no legal review…)."""


@dataclass
class Example:
    building_id: str
    layer_name: str
    label: str
    summary: dict[str, Any]
    file_name: str
    created_at: str
    augmented: bool = False


@dataclass
class Dataset:
    train: list[Example]
    val: list[Example]
    train_venues: list[str]
    val_venues: list[str]
    registry: dict[str, Any]
    dropped: Counter[str] = field(default_factory=Counter)
    warnings: list[str] = field(default_factory=list)
    synthetic: bool = False


def legal_review_confirmed() -> bool:
    return os.environ.get(LEGAL_REVIEW_ENV, "").strip() == str(CONSENT_NOTICE_VERSION)


def is_synthetic(row: dict[str, Any]) -> bool:
    return "synthetic" in str(row.get("file_name", "")).lower() or bool((row.get("layer_summary") or {}).get("synthetic"))


def clean_rows(rows: list[dict[str, Any]], *, allow_synthetic: bool = False) -> tuple[list[Example], Counter[str]]:
    """Checks every row again and keeps the latest confirmation per (venue, layer)."""
    dropped: Counter[str] = Counter()
    if not allow_synthetic and any(is_synthetic(r) for r in rows):
        raise DatasetError("These rows include a SYNTHETIC fixture. Synthetic data is never training data "
                           "(use --synthetic-dry-run only to test the pipeline).")
    latest: dict[tuple[str, str], Example] = {}
    for r in rows:
        label = r.get("final_label")
        if r.get("confirmed_via") not in CONFIRMED_VIA_ALLOWED:
            dropped["not confirmed individually or by group"] += 1
            continue
        if label not in LABELS or label == "unknown":
            dropped["label missing, unknown or not in the list"] += 1
            continue
        summary = dict(r.get("layer_summary") or {})
        if not INCLUDE_TEXT_SAMPLES:
            summary["texts"] = []
        ex = Example(
            building_id=str(r["building_id"]), layer_name=str(r["layer_name"]), label=label, summary=summary,
            file_name=str(r.get("file_name", "")), created_at=str(r.get("created_at", "")),
        )
        key = (ex.building_id, ex.layer_name.strip().lower())
        if key in latest:
            dropped["older confirmation of the same layer"] += 1
            if latest[key].created_at >= ex.created_at:
                continue
        latest[key] = ex
    return list(latest.values()), dropped


# ── Frozen whole-venue split ─────────────────────────────────────────────────

def empty_registry() -> dict[str, Any]:
    return {"note": "Frozen train/validation split per venue (opaque venue ids). Only grows; never edit by hand.", "venues": {}}


def load_registry(path: Path) -> dict[str, Any]:
    if not path.exists():
        return empty_registry()
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data.get("venues"), dict):
        raise DatasetError(f"{path} is not a held-out venue registry")
    return data


def save_registry(path: Path, registry: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(registry, indent=2, sort_keys=True), encoding="utf-8")


def assign_splits(venues: list[str], registry: dict[str, Any], *, seed: str = "yetnew",
                  val_fraction: float = VAL_FRACTION) -> tuple[list[str], list[str], dict[str, Any]]:
    """(train venues, validation venues, updated registry) for the venues in this export.

    Known venues keep their recorded split. New venues (in a fixed order: a
    hash of seed + id) are held out while fewer than ~val_fraction of all
    recorded venues are; the choice is then recorded for good.
    """
    if len(venues) < MIN_VENUES:
        raise DatasetError(f"Only {len(venues)} venue(s) have confirmed, consented layers; at least {MIN_VENUES} are needed "
                           "so that whole venues can be held out for validation.")
    known: dict[str, Any] = {k: dict(v) for k, v in registry.get("venues", {}).items()}
    today = datetime.now(timezone.utc).date().isoformat()
    new = sorted((v for v in venues if v not in known), key=lambda v: hashlib.sha256(f"{seed}:{v}".encode()).hexdigest())
    for v in new:
        n_val = sum(1 for e in known.values() if e["split"] == "val")
        target = max(1, round((len(known) + 1) * val_fraction))
        known[v] = {"split": "val" if n_val < target else "train", "first_seen": today}
    train = sorted(v for v in venues if known[v]["split"] == "train")
    val = sorted(v for v in venues if known[v]["split"] == "val")
    if not train or not val:
        raise DatasetError(f"The frozen split leaves {len(train)} training and {len(val)} validation venue(s) in this export; "
                           "both are needed. Add more venues.")
    return train, val, {**registry, "venues": known}


def name_variants(name: str) -> list[str]:
    """Spellings an architect might use for the same layer: case and separator changes."""
    out = []
    for v in (name.lower(), name.replace("-", "_"), name.replace("_", "-").upper()):
        if v != name and v not in out:
            out.append(v)
    return out


#: Names people who aren't CAD experts (or export tools) give layers.
GENERIC_NAMES = ("Layer {n}", "0", "New Layer", "Layer{n}", "layer_{n}", "Untitled {n}")


def generic_name(ex: Example, i: int) -> str:
    """A deterministic generic name for one augmented copy of a layer."""
    k = int(hashlib.sha256(f"{ex.building_id}:{ex.layer_name}:{i}".encode()).hexdigest(), 16)
    return GENERIC_NAMES[k % len(GENERIC_NAMES)].format(n=k % 20 + 1)


def augment(examples: list[Example], copies: int, generic_copies: int = 0) -> list[Example]:
    """Training-set copies: spelling variants of the name, and (optionally) the same
    content under a meaningless name — so the model learns to judge layers by
    content, as uploads from non-architects need."""
    extra: list[Example] = []
    for ex in examples:
        for v in name_variants(ex.layer_name)[:copies]:
            extra.append(Example(ex.building_id, v, ex.label, {**ex.summary, "name": v}, ex.file_name, ex.created_at, augmented=True))
        for i in range(generic_copies):
            g = generic_name(ex, i)
            extra.append(Example(ex.building_id, g, ex.label, {**ex.summary, "name": g}, ex.file_name, ex.created_at, augmented=True))
    return extra


def build_dataset(rows: list[dict[str, Any]], *, registry: dict[str, Any] | None = None, seed: str = "yetnew",
                  augment_copies: int = 1, generic_name_copies: int = 0, allow_synthetic: bool = False) -> Dataset:
    synthetic = any(is_synthetic(r) for r in rows)
    if not synthetic and rows and not legal_review_confirmed():
        raise DatasetError(f"Exporting customer venues is disabled until the training-consent notice (version "
                           f"{CONSENT_NOTICE_VERSION}) has had legal review. Then set {LEGAL_REVIEW_ENV}={CONSENT_NOTICE_VERSION}.")
    examples, dropped = clean_rows(rows, allow_synthetic=allow_synthetic)
    venues = sorted({e.building_id for e in examples})
    train_v, val_v, new_registry = assign_splits(venues, registry or empty_registry(), seed=seed)
    train = [e for e in examples if e.building_id in train_v]
    val = [e for e in examples if e.building_id in val_v]
    train += augment(train, augment_copies, generic_name_copies)  # training set only

    warnings: list[str] = []
    real = [e for e in train if not e.augmented] + val
    if len(venues) < TARGET_VENUES:
        warnings.append(f"{len(venues)} venues; aim for {TARGET_VENUES}-30 varied venues.")
    if len(real) < TARGET_LAYERS:
        warnings.append(f"{len(real)} labeled layers; aim for {TARGET_LAYERS}+.")
    counts = Counter(e.label for e in real)
    thin = [f"{label} ({counts.get(label, 0)})" for label in LABELS if label != "unknown" and counts.get(label, 0) < TARGET_PER_LABEL]
    if thin:
        warnings.append(f"Fewer than {TARGET_PER_LABEL} examples: {', '.join(thin)}.")
    return Dataset(train, val, train_v, val_v, new_registry, dropped, warnings, synthetic=synthetic)


def label_counts(examples: list[Example]) -> dict[str, int]:
    c = Counter(e.label for e in examples)
    return {label: c.get(label, 0) for label in LABELS if label != "unknown"}


def write_dataset(ds: Dataset, out_dir: Path) -> dict[str, Any]:
    """train.jsonl / val.jsonl (chat rows), val_layers.jsonl (for evaluate.py),
    example_bank.jsonl (retrieval: training venues only), manifest.json."""
    out_dir.mkdir(parents=True, exist_ok=True)

    def row(e: Example) -> dict[str, Any]:
        return {**training_example(e.summary, e.label), "label": e.label, "building_id": e.building_id, "augmented": e.augmented}

    def lines(name: str, items: list[dict[str, Any]]) -> None:
        with (out_dir / name).open("w", encoding="utf-8", newline="\n") as f:
            for item in items:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")

    lines("train.jsonl", [row(e) for e in ds.train])
    lines("val.jsonl", [row(e) for e in ds.val])
    lines("val_layers.jsonl", [{"building_id": e.building_id, "label": e.label, "summary": e.summary} for e in ds.val])
    lines("example_bank.jsonl", [{"building_id": e.building_id, "label": e.label, "summary": e.summary}
                                 for e in ds.train if not e.augmented])

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "synthetic": ds.synthetic,
        "prompt_version": PROMPT_VERSION,
        "include_text_samples": INCLUDE_TEXT_SAMPLES,
        "venues": {"train": ds.train_venues, "val": ds.val_venues},
        "examples": {"train": len(ds.train), "train_augmented": sum(e.augmented for e in ds.train), "val": len(ds.val)},
        "label_counts": {"train": label_counts([e for e in ds.train if not e.augmented]), "val": label_counts(ds.val)},
        "dropped": dict(ds.dropped),
        "warnings": ds.warnings,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
