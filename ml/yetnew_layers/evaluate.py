"""Baseline, baseline + retrieved examples, and fine-tuned — through Ollama, on
the held-out venues of an export.

All three label the same validation layers (val_layers.jsonl — frozen venues
that were never trained on) through the same code the service uses
(classify_baseline / classify_finetuned → Ollama; retrieval draws from the
export's example_bank.jsonl, training venues only). Scored per layer, per
label and per venue.

The fine-tuned model replaces the service's current mode (the "reference":
baseline, or baseline + retrieval when YETNEW_RETRIEVAL_K > 0) only if ALL hold:
  * accuracy at least WIN_MARGIN (3 points) higher, and
  * the 95% confidence interval of that difference lies above 0 (bootstrap
    over whole venues, since layers of one venue are not independent), and
  * no lower accuracy on wall, walkable or ignore (NO_REGRESSION_LABELS).

model_choice.json may only be written when the comparison means something:
  * real data (not the synthetic dry run),
  * at least MIN_VAL_VENUES venues and MIN_VAL_LAYERS layers held out,
  * at least MIN_VAL_PER_LABEL held-out examples of every label present, and
    of each no-regression label,
  * exported with the current PROMPT_VERSION and text-sample setting,
  * a current, passing check_template.py for the fine-tuned model on this
    Ollama version and model digest.
"""

from __future__ import annotations

import json
import random
import time
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .classify import ChatFn, LayerResult, classify_baseline, classify_finetuned
from .config import Settings
from .labels import LABELS
from .ollama import chat
from .prompt import INCLUDE_TEXT_SAMPLES, PROMPT_VERSION
from .retrieval import ExampleBank

MIN_VAL_VENUES = 3
MIN_VAL_LAYERS = 100
MIN_VAL_PER_LABEL = 10
WIN_MARGIN = 0.03
NO_REGRESSION_LABELS = ("wall", "walkable", "ignore")
BOOTSTRAP_SAMPLES = 2000
CONFIDENCE = 0.95


@dataclass
class Report:
    model: str
    kind: str          # "baseline" | "retrieval" | "finetuned"
    n: int
    correct: int
    accuracy: float
    per_label: dict[str, dict[str, float]]
    per_venue: dict[str, float]
    confusions: list[tuple[str, str, int]]
    mistakes: list[dict[str, Any]]
    seconds: float
    #: Right/wrong per validation layer, in val_layers order (for paired statistics).
    hits: list[bool] = field(default_factory=list, repr=False)
    #: Printed with the result (retrieval: whether every example came from another venue).
    note: str = ""


@dataclass
class Comparison:
    """`challenger` against `reference` under the switch rule."""
    challenger: str
    reference: str
    difference: float
    ci_low: float
    ci_high: float
    margin_ok: bool
    ci_ok: bool
    regressions: list[str]

    @property
    def wins(self) -> bool:
        return self.margin_ok and self.ci_ok and not self.regressions


@dataclass
class Decision:
    winner: str
    can_write: bool
    reference: str
    comparison: Comparison
    reasons: list[str] = field(default_factory=list)


def load_val(dataset_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = json.loads((dataset_dir / "manifest.json").read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in (dataset_dir / "val_layers.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    return manifest, rows


def score(model: str, kind: str, rows: list[dict[str, Any]], results: list[LayerResult], seconds: float) -> Report:
    by_label: dict[str, list[bool]] = defaultdict(list)
    by_venue: dict[str, list[bool]] = defaultdict(list)
    confusions: Counter[tuple[str, str]] = Counter()
    mistakes, hits = [], []
    for row, r in zip(rows, results):
        ok = r.label == row["label"]
        hits.append(ok)
        by_label[row["label"]].append(ok)
        by_venue[row["building_id"]].append(ok)
        if not ok:
            confusions[(row["label"], r.label)] += 1
            mistakes.append({"building_id": row["building_id"], "layer": row["summary"].get("name"),
                             "expected": row["label"], "got": r.label, "confidence": r.confidence})
    n, correct = len(rows), sum(hits)
    return Report(
        model=model, kind=kind, n=n, correct=correct, accuracy=round(correct / n, 4) if n else 0.0,
        per_label={label: {"support": len(v), "correct": sum(v), "accuracy": round(sum(v) / len(v), 4)}
                   for label in LABELS if (v := by_label.get(label))},
        per_venue={venue: round(sum(v) / len(v), 4) for venue, v in sorted(by_venue.items())},
        confusions=[(a, b, k) for (a, b), k in confusions.most_common(10)],
        mistakes=mistakes, seconds=round(seconds, 1), hits=hits,
    )


def run(rows: list[dict[str, Any]], settings: Settings, *, baseline_model: str, finetuned_model: str | None,
        chat_fn: ChatFn = chat, bank: ExampleBank | None = None, retrieval_k: int = 3,
        exclude_same_venue: bool = True) -> dict[str, Report]:
    """Labels the held-out layers with every option; retrieval only when a bank is given.

    Retrieval: each layer gets examples with its own venue excluded, and every
    example actually sent is checked. Only if none came from the venue being
    scored is the result reported as "retrieval" (a headline number, usable in
    the switch rule). Otherwise it is "retrieval_diagnostic": shown, never
    compared. (`exclude_same_venue=False` exists to test that path.)
    """
    summaries = [r["summary"] for r in rows]
    reports: dict[str, Report] = {}

    t = time.perf_counter()
    base = classify_baseline(summaries, settings, model=baseline_model, chat_fn=chat_fn)
    reports["baseline"] = score(baseline_model, "baseline", rows, base, time.perf_counter() - t)

    if bank is not None and len(bank) and retrieval_k > 0:
        t = time.perf_counter()
        chosen = [bank.nearest(r["summary"], retrieval_k, exclude_building=r["building_id"] if exclude_same_venue else None)
                  for r in rows]
        used = sum(len(c) for c in chosen)
        same = sum(e.building_id == r["building_id"] for r, c in zip(rows, chosen) for e in c)
        ret = classify_baseline(summaries, settings, model=baseline_model, chat_fn=chat_fn,
                                examples=[[(e.summary, e.label) for e in c] for c in chosen])
        kind = "retrieval" if same == 0 else "retrieval_diagnostic"
        report = score(f"{baseline_model} + {retrieval_k} retrieved examples", kind, rows, ret, time.perf_counter() - t)
        report.note = (f"every retrieved example came from a different venue than the layer it was shown with "
                       f"(checked {used} examples for {len(rows)} layers)" if same == 0 else
                       f"DIAGNOSTIC ONLY — {same} of {used} retrieved examples came from the venue being scored, "
                       f"so this number is not comparable and is used in no comparison")
        reports[kind] = report

    if finetuned_model is None:   # the score to beat, before any fine-tuned model exists
        return reports
    t = time.perf_counter()
    baseline_fn: Callable[[list[dict[str, Any]]], list[LayerResult]] = (
        lambda ss: classify_baseline(ss, settings, model=baseline_model, chat_fn=chat_fn))
    ft = classify_finetuned(summaries, settings, model=finetuned_model, chat_fn=chat_fn, baseline_fn=baseline_fn)
    reports["finetuned"] = score(finetuned_model, "finetuned", rows, ft, time.perf_counter() - t)
    return reports


def bootstrap_ci(rows: list[dict[str, Any]], a: list[bool], b: list[bool], *, samples: int = BOOTSTRAP_SAMPLES,
                 confidence: float = CONFIDENCE, seed: int = 20261012) -> tuple[float, float]:
    """CI of accuracy(a) − accuracy(b), resampling whole venues (paired: same layers for both).
    With one venue the interval collapses to a point — one reason for MIN_VAL_VENUES."""
    venues: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        venues[r["building_id"]].append(i)
    groups = list(venues.values())
    rng = random.Random(seed)
    diffs = []
    for _ in range(samples):
        idx = [i for g in (rng.choice(groups) for _ in groups) for i in g]
        diffs.append((sum(a[i] for i in idx) - sum(b[i] for i in idx)) / len(idx))
    diffs.sort()
    lo = diffs[int((1 - confidence) / 2 * samples)]
    hi = diffs[min(samples - 1, int((1 + confidence) / 2 * samples))]
    return round(lo, 4), round(hi, 4)


def compare(rows: list[dict[str, Any]], challenger: Report, reference: Report, *, margin: float = WIN_MARGIN) -> Comparison:
    lo, hi = bootstrap_ci(rows, challenger.hits, reference.hits)
    regressions = [
        label for label in NO_REGRESSION_LABELS
        if label in reference.per_label
        and challenger.per_label.get(label, {"accuracy": 0.0})["accuracy"] < reference.per_label[label]["accuracy"]
    ]
    diff = round(challenger.accuracy - reference.accuracy, 4)
    return Comparison(challenger.kind, reference.kind, diff, lo, hi, diff >= margin, lo > 0, regressions)


def decide(manifest: dict[str, Any], rows: list[dict[str, Any]], reports: dict[str, Report], *, reference: str = "baseline",
           template: tuple[bool, str] = (False, "not checked"), min_venues: int = MIN_VAL_VENUES,
           min_layers: int = MIN_VAL_LAYERS, min_per_label: int = MIN_VAL_PER_LABEL, margin: float = WIN_MARGIN) -> Decision:
    ref = reports[reference]
    comparison = compare(rows, reports["finetuned"], ref, margin=margin)
    winner = "finetuned" if comparison.wins else reference
    reasons = []
    if manifest.get("synthetic"):
        reasons.append("the dataset is the SYNTHETIC dry run — never a basis for choosing a model")
    venues = len(manifest.get("venues", {}).get("val", []))
    if venues < min_venues:
        reasons.append(f"only {venues} held-out venue(s); at least {min_venues} needed")
    if ref.n < min_layers:
        reasons.append(f"only {ref.n} held-out layers; at least {min_layers} needed")
    support = {label: int(v["support"]) for label, v in ref.per_label.items()}
    thin = sorted({label for label, n in support.items() if n < min_per_label}
                  | {label for label in NO_REGRESSION_LABELS if support.get(label, 0) < min_per_label})
    if thin:
        reasons.append(f"fewer than {min_per_label} held-out examples of: " + ", ".join(f"{label} ({support.get(label, 0)})" for label in thin))
    if manifest.get("prompt_version") != PROMPT_VERSION:
        reasons.append(f"exported with prompt version {manifest.get('prompt_version')}, the code is at {PROMPT_VERSION} — export and train again")
    if manifest.get("include_text_samples") != INCLUDE_TEXT_SAMPLES:
        reasons.append("exported with a different INCLUDE_TEXT_SAMPLES setting than the service uses now")
    if not template[0]:
        reasons.append(f"template check not current: {template[1]}")
    return Decision(winner=winner, can_write=not reasons, reference=reference, comparison=comparison, reasons=reasons)


def choice_record(manifest: dict[str, Any], reports: dict[str, Report], decision: Decision, *, retrieval_k: int = 0) -> dict[str, Any]:
    """model_choice.json: what models.finetuned_approved checks, plus the evidence."""
    c = decision.comparison
    return {
        "winner": decision.winner,
        "finetuned_model": reports["finetuned"].model,
        "baseline_model": reports["baseline"].model,
        "reference": decision.reference,
        "retrieval_k": retrieval_k if decision.reference == "retrieval" else 0,
        "prompt_version": PROMPT_VERSION,
        "include_text_samples": INCLUDE_TEXT_SAMPLES,
        "accuracy": {kind: r.accuracy for kind, r in reports.items()},
        "difference": c.difference, "ci95": [c.ci_low, c.ci_high], "regressions": c.regressions,
        "rule": {"margin": WIN_MARGIN, "ci": CONFIDENCE, "no_regression": list(NO_REGRESSION_LABELS),
                 "min_val_venues": MIN_VAL_VENUES, "min_val_layers": MIN_VAL_LAYERS, "min_val_per_label": MIN_VAL_PER_LABEL},
        "val_layers": reports["baseline"].n,
        "val_venues": manifest["venues"]["val"],
        "dataset_created_at": manifest.get("created_at"),
        "decided_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def per_label_table(reports: dict[str, Report], reference: str) -> list[str]:
    """Side-by-side per-label accuracy for human review; ▼ marks a drop of the fine-tuned model vs the reference."""
    kinds = [k for k in ("baseline", "retrieval", "finetuned") if k in reports]
    head = f"  {'label':<12} {'n':>4} " + " ".join(f"{k:>10}" for k in kinds) + f" {'ft − ref':>9}"
    out = [head]
    for label in LABELS:
        ref = reports[reference].per_label.get(label)
        if not ref:
            continue
        cells = [reports[k].per_label.get(label, {}).get("accuracy") for k in kinds]
        ft = reports["finetuned"].per_label.get(label, {}).get("accuracy", 0.0)
        delta = ft - ref["accuracy"]
        flag = " ▼" if delta < 0 and label in NO_REGRESSION_LABELS else (" ↓" if delta < 0 else "")
        out.append(f"  {label:<12} {int(ref['support']):>4} " + " ".join(f"{c:>10.1%}" if c is not None else f"{'-':>10}" for c in cells)
                   + f" {delta:>+9.1%}{flag}")
    return out


def report_dict(reports: dict[str, Report], decision: Decision) -> dict[str, Any]:
    out: dict[str, Any] = {k: {key: val for key, val in asdict(r).items() if key != "hits"} for k, r in reports.items()}
    out["decision"] = {**asdict(decision), "comparison": {**asdict(decision.comparison), "wins": decision.comparison.wins}}
    return out
