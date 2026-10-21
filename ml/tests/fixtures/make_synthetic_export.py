"""Builds rows shaped like layer_label_training_rows() from the SYNTHETIC fixture,
spread over five fake venues, to test export → evaluate end to end.

SYNTHETIC — NEVER TRAINING DATA. Every row's file name says SYNTHETIC, so
export_dataset refuses it unless --synthetic-dry-run, and the output is marked
synthetic (the notebook and evaluate.py refuse to train on or approve it).

    python tests/fixtures/make_synthetic_export.py        # → data/synthetic_export.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ML))

from yetnew_layers.summarize import summarize_file  # noqa: E402

HERE = Path(__file__).parent
VENUES = 5


def variant(name: str, v: int) -> str:
    """Each fake venue spells its layers a little differently."""
    return [name, name.lower(), name.replace("-", "_"), name.replace("-", "."), f"{name}-NEW"][v % 5]


def make_rows() -> list[dict]:
    summaries = summarize_file(HERE / "SYNTHETIC_architect_plan.dxf")
    expected = json.loads((HERE / "SYNTHETIC_expected_labels.json").read_text(encoding="utf-8"))
    assert expected["synthetic"] and expected["do_not_train"]
    rows = []
    for v in range(VENUES):
        for s in summaries:
            label = expected["labels"][s["name"]]
            if label == "unknown":
                continue  # can't be confirmed, so never exported
            name = variant(s["name"], v)
            rows.append({
                "id": f"synthetic-{v}-{name}", "building_id": f"00000000-0000-4000-8000-5717e7c0000{v}",
                "import_id": f"00000000-0000-4000-8000-5717e7c1000{v}", "file_name": "SYNTHETIC_architect_plan.dxf",
                "layer_name": name, "layer_summary": {**s, "name": name, "synthetic": True},
                "summarizer_version": 1, "prompt_version": 3, "ai_model": "qwen2.5:3b", "ai_label": label,
                "ai_confidence": 0.9, "final_label": label, "was_corrected": False,
                "confirmed_via": "group" if v % 2 else "individual", "created_at": f"2026-10-10T10:0{v}:00+00:00",
            })
    return rows


if __name__ == "__main__":
    out = ML / "data" / "synthetic_export.json"
    out.parent.mkdir(exist_ok=True)
    rows = make_rows()
    out.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    print(f"SYNTHETIC: wrote {len(rows)} rows for {VENUES} fake venues to {out}")
