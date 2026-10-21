"""Smoke test: runtime and sanity on local DXF files. Not an accuracy measure.

    python scripts/smoke_test.py ml/data/smoke/*.dxf --model qwen2.5:3b
    python scripts/smoke_test.py tests/fixtures/SYNTHETIC_architect_plan.dxf --expected tests/fixtures/SYNTHETIC_expected_labels.json

For each file: layers, time to summarize, time to label, how many need
review, and the label spread. Per-layer results go to <out>/<file>.json so
they can be read next to the drawing. With --expected (the SYNTHETIC fixture
only) it also counts agreement — a sanity check, never a benchmark.

Files under ml/data/ are git-ignored and are never training data.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.classify import classify_baseline  # noqa: E402
from yetnew_layers.config import load_settings  # noqa: E402
from yetnew_layers.summarize import DxfReadError, summarize_file  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+")
    parser.add_argument("--model", help="Ollama model (default YETNEW_BASE_MODEL)")
    parser.add_argument("--summarize-only", action="store_true", help="Skip the model: layer counts and timing only.")
    parser.add_argument("--expected", help="JSON with {labels: {layer: label}} — SYNTHETIC fixture only.")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "data" / "smoke" / "results"))
    args = parser.parse_args()

    settings = load_settings()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    expected = json.loads(Path(args.expected).read_text())["labels"] if args.expected else None

    print(f"{'file':<58} {'layers':>6} {'sum s':>6} {'label s':>8} {'review':>6}  labels")
    for name in args.files:
        path = Path(name)
        t0 = time.perf_counter()
        try:
            summaries = summarize_file(path)
        except DxfReadError as err:
            print(f"{path.name:<58} unreadable: {err}")
            continue
        t1 = time.perf_counter()
        if args.summarize_only:
            on_zero = next((s["total"] for s in summaries if s["name"] == "0"), 0)
            total = sum(s["total"] for s in summaries)
            print(f"{path.name:<58} {len(summaries):>6} {t1 - t0:>6.1f}        -      -  entities={total}, on layer 0: {on_zero}")
            continue
        results = classify_baseline(summaries, settings, model=args.model)
        t2 = time.perf_counter()
        review = sum(r.needs_review for r in results)
        spread = Counter(r.label for r in results).most_common()
        print(f"{path.name:<58} {len(results):>6} {t1 - t0:>6.1f} {t2 - t1:>8.1f} {review:>6}  " + ", ".join(f"{k} {v}" for k, v in spread))
        rows = [{**r.to_dict(), "summary": s} for r, s in zip(results, summaries)]
        if expected:
            hits = sum(r.label == expected.get(r.name) for r in results)
            print(f"  agreement with the SYNTHETIC expected labels: {hits}/{len(results)} (sanity only)")
            for r in sorted(results, key=lambda r: (r.confidence is not None, r.confidence or 0.0)):
                mark = "ok   " if r.label == expected.get(r.name) else "WRONG"
                print(f"    {mark} {r.name:<14} expected {expected.get(r.name)!s:<11} got {r.label:<11} p={r.confidence}  flagged={r.needs_review}")
            right = [r.confidence for r in results if r.label == expected.get(r.name) and r.confidence is not None]
            wrong = [r.confidence for r in results if r.label != expected.get(r.name) and r.confidence is not None]
            if right and wrong:
                print(f"  confidence: right answers mean {sum(right) / len(right):.3f} (min {min(right):.3f}), "
                      f"wrong answers mean {sum(wrong) / len(wrong):.3f} (max {max(wrong):.3f})")
        (out / f"{path.stem}.json").write_text(json.dumps({"file": path.name, "model": args.model or settings.base_model, "seconds": round(t2 - t1, 1), "layers": rows}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
