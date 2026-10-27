"""evaluate: scoring, the switch rule (margin, venue-bootstrap CI, no regression,
per-label minimums), and when model_choice.json may be written."""

from __future__ import annotations

import json
from typing import Any

from yetnew_layers.config import Settings
from yetnew_layers.evaluate import (
    MIN_VAL_LAYERS,
    MIN_VAL_PER_LABEL,
    MIN_VAL_VENUES,
    NO_REGRESSION_LABELS,
    WIN_MARGIN,
    bootstrap_ci,
    choice_record,
    decide,
    per_label_table,
    run,
)
from yetnew_layers.models import finetuned_approved
from yetnew_layers.prompt import INCLUDE_TEXT_SAMPLES, PROMPT_VERSION

SETTINGS = Settings(ollama_url="http://ollama", base_model="base", finetuned_model="yetnew-layers", batch_size=50, timeout=5)
LABELS4 = ["wall", "walkable", "ignore", "door"]
CHECKED = (True, "")


def val_rows(venues: int, per_venue: int, labels: list[str] = LABELS4) -> list[dict[str, Any]]:
    return [{"building_id": f"v{v}", "label": labels[i % len(labels)],
             "summary": {"name": f"V{v}-L{i}", "entity_counts": {"LINE": 1}, "blocks": [], "texts": []}}
            for v in range(venues) for i in range(per_venue)]


def manifest(venues: int, **over: Any) -> dict[str, Any]:
    return {"synthetic": False, "prompt_version": PROMPT_VERSION, "include_text_samples": INCLUDE_TEXT_SAMPLES,
            "venues": {"train": ["t1"], "val": [f"v{i}" for i in range(venues)]}, "created_at": "2026-10-12", **over}


def fake_ollama(rows: list[dict[str, Any]], base_wrong: set[str], ft_wrong: set[str]):
    """Baseline (batched JSON) and fine-tuned (one label) answers, wrong on the given layers."""
    truth = {r["summary"]["name"]: r["label"] for r in rows}
    calls: list[str] = []

    def chat_fn(url: str, model: str, messages: list[dict[str, str]], **kw: Any) -> dict[str, Any]:
        calls.append(model)
        if model == "base":
            names = [json.loads(line.rstrip(","))["layer"] for line in messages[1]["content"].splitlines()[2:-1]]
            items = [{"name": n, "label": "door" if n in base_wrong and truth[n] != "door" else
                      ("wall" if n in base_wrong else truth[n])} for n in names]
            return {"message": {"content": json.dumps({"layers": items})}}
        name = json.loads(messages[1]["content"])["layer"]
        wrong = "door" if truth[name] != "door" else "wall"
        return {"message": {"content": wrong if name in ft_wrong else truth[name]}, "logprobs": [{"logprob": -0.01}]}

    return chat_fn, calls


def evaluate(rows: list[dict[str, Any]], base_wrong: set[str], ft_wrong: set[str]):
    return run(rows, SETTINGS, baseline_model="base", finetuned_model="yetnew-layers",
               chat_fn=fake_ollama(rows, base_wrong, ft_wrong)[0])


def spread(rows: list[dict[str, Any]], fraction: float, label: str | None = None, offset: int = 0) -> set[str]:
    """Every n-th layer (of one label, if given), spread over all venues."""
    pool = [r["summary"]["name"] for r in rows if label is None or r["label"] == label]
    step = max(1, round(1 / fraction))
    return set(pool[offset::step])


def test_all_options_run_through_the_service_code_and_are_scored_per_label() -> None:
    rows = val_rows(3, 40)
    chat_fn, calls = fake_ollama(rows, base_wrong={"V0-L0", "V0-L4", "V1-L1"}, ft_wrong={"V2-L2"})
    reports = run(rows, SETTINGS, baseline_model="base", finetuned_model="yetnew-layers", chat_fn=chat_fn)
    assert {"base", "yetnew-layers"} <= set(calls) and set(reports) == {"baseline", "finetuned"}
    base, ft = reports["baseline"], reports["finetuned"]
    assert (base.n, base.correct) == (120, 117) and ft.correct == 119
    assert base.per_label["wall"] == {"support": 30, "correct": 28, "accuracy": 0.9333}
    assert base.per_venue["v0"] == 0.95
    assert {m["layer"] for m in base.mistakes} == {"V0-L0", "V0-L4", "V1-L1"}


def test_clear_win_on_enough_real_data_is_recorded() -> None:
    rows = val_rows(4, 40)                                    # 160 layers, 40 per label
    reports = evaluate(rows, base_wrong=spread(rows, 0.15), ft_wrong=set())
    d = decide(manifest(4), rows, reports, template=CHECKED)
    assert d.comparison.wins and d.winner == "finetuned" and d.can_write, d.reasons
    assert d.comparison.ci_low > 0
    record = choice_record(manifest(4), reports, d)
    assert finetuned_approved(SETTINGS, record)
    assert record["rule"]["margin"] == WIN_MARGIN and record["ci95"][0] > 0


def test_small_gain_loses_on_margin() -> None:
    rows = val_rows(4, 40)
    reports = evaluate(rows, base_wrong=spread(rows, 0.02), ft_wrong=set())   # ~2 points better
    d = decide(manifest(4), rows, reports, template=CHECKED)
    assert not d.comparison.margin_ok and d.winner == "baseline"


def test_gain_from_one_venue_fails_the_confidence_interval() -> None:
    rows = val_rows(4, 40)
    one_venue = {r["summary"]["name"] for r in rows if r["building_id"] == "v0"}
    reports = evaluate(rows, base_wrong={n for i, n in enumerate(sorted(one_venue)) if i % 4}, ft_wrong=set())
    d = decide(manifest(4), rows, reports, template=CHECKED)
    assert d.comparison.margin_ok and not d.comparison.ci_ok and d.winner == "baseline"


def test_regression_on_wall_walkable_or_ignore_blocks_the_switch() -> None:
    rows = val_rows(4, 40)
    for label in NO_REGRESSION_LABELS:
        # The fine-tuned model is much better on doors but slips on `label`.
        reports = evaluate(rows, base_wrong=spread(rows, 0.5, "door"), ft_wrong=spread(rows, 0.1, label))
        d = decide(manifest(4), rows, reports, template=CHECKED)
        assert d.comparison.regressions == [label] and d.winner == "baseline", label


def test_choice_needs_enough_real_held_out_data_and_a_template_check() -> None:
    rows = val_rows(4, 40)
    reports = evaluate(rows, base_wrong=spread(rows, 0.15), ft_wrong=set())
    assert decide(manifest(4), rows, reports, template=CHECKED).can_write
    assert MIN_VAL_VENUES == 3 and MIN_VAL_LAYERS == 100 and MIN_VAL_PER_LABEL == 10

    def why(**kw: Any) -> str:
        m = kw.pop("m", manifest(4))
        return " ".join(decide(m, rows, reports, **{"template": CHECKED, **kw}).reasons)

    assert "held-out venue" in why(m=manifest(2))
    assert "SYNTHETIC" in why(m=manifest(4, synthetic=True))
    assert "prompt version" in why(m=manifest(4, prompt_version=PROMPT_VERSION - 1))
    assert "INCLUDE_TEXT_SAMPLES" in why(m=manifest(4, include_text_samples=not INCLUDE_TEXT_SAMPLES))
    assert "template check" in why(template=(False, "Ollama changed"))

    small = val_rows(3, 20)
    r2 = evaluate(small, set(), set())
    assert "held-out layers" in " ".join(decide(manifest(3), small, r2, template=CHECKED).reasons)


def test_labels_with_too_few_held_out_examples_are_noted_not_judged() -> None:
    """Owner's choice (2026-10-27): with 2 restroom and 1 walkway layers held out, those labels
    can't block a switch or count as worse; they're reported. Labels with evidence still can."""
    rows = val_rows(4, 40)
    rows += [{"building_id": "v0", "label": "elevator", "summary": {"name": f"LIFT-{i}", "entity_counts": {}, "blocks": [], "texts": []}}
             for i in range(4)]
    reports = evaluate(rows, base_wrong=spread(rows, 0.15), ft_wrong=set())
    d = decide(manifest(4), rows, reports, template=CHECKED)
    assert d.can_write and "elevator (4)" in " ".join(d.notes) and not d.reasons
    # One walkway layer got wrong (the only one held out) is not a regression…
    thin = val_rows(4, 40, ["wall", "ignore", "door", "window"])
    thin.append({"building_id": "v1", "label": "walkable", "summary": {"name": "WALK-1", "entity_counts": {}, "blocks": [], "texts": []}})
    r2 = evaluate(thin, base_wrong=spread(thin, 0.5, "door"), ft_wrong={"WALK-1"})
    d2 = decide(manifest(4), thin, r2, template=CHECKED)
    assert d2.comparison.regressions == [] and d2.winner == "finetuned" and "walkable (1)" in " ".join(d2.notes)
    # …but walls, with plenty held out, still are.
    r3 = evaluate(thin, base_wrong=spread(thin, 0.5, "door"), ft_wrong=spread(thin, 0.1, "wall"))
    assert decide(manifest(4), thin, r3, template=CHECKED).comparison.regressions == ["wall"]


def test_bootstrap_is_paired_and_deterministic() -> None:
    rows = val_rows(5, 20)
    same = [True] * len(rows)
    assert bootstrap_ci(rows, same, same) == (0.0, 0.0)
    a = [i % 3 != 0 for i in range(len(rows))]
    assert bootstrap_ci(rows, a, same) == bootstrap_ci(rows, a, same)
    lo, hi = bootstrap_ci(rows, a, same)
    diff = (sum(a) - len(a)) / len(a)                     # about -33%
    assert lo <= diff <= hi < 0


def test_per_label_table_marks_regressions_for_review() -> None:
    rows = val_rows(4, 40)
    reports = evaluate(rows, base_wrong=set(), ft_wrong=spread(rows, 0.25, "wall"))
    table = "\n".join(per_label_table(reports, "baseline"))
    wall = next(line for line in table.splitlines() if line.strip().startswith("wall"))
    assert "▼" in wall and "100.0%" in wall
