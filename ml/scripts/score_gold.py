"""Score the baseline labeler against your hand labels (gold CSVs).

    python scripts/score_gold.py [--gold data/gold] [--model qwen2.5:3b] [--allow-partial]

For each data/gold/<drawing>.csv with my_label filled in: label the drawing
with the baseline through Ollama — retrieval OFF, so no examples from any
file (least of all the one being scored) — and compare with my_label.

Reports accuracy by layer and weighted by entity count, per label, per file,
every wrong layer with its entity count, whether confidence was lower on
wrong answers, and flags wrong answers on wall / walkable / ignore and on big
layers. Says how many files and layers the numbers come from. Writes
data/gold/report.json. Refuses to score a CSV with empty labels unless
--allow-partial (then those layers are left out and counted).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.classify import classify_baseline  # noqa: E402
from yetnew_layers.config import load_settings  # noqa: E402
from yetnew_layers.gold import GoldError, Scored, load_files_map, load_gold_csv, score  # noqa: E402
from yetnew_layers.ollama import OllamaError, OllamaUnavailable  # noqa: E402
from yetnew_layers.summarize import summarize_file  # noqa: E402

ML = Path(__file__).resolve().parents[1]


def main() -> int:
    s = load_settings()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gold", default=str(ML / "data" / "gold"))
    parser.add_argument("--model", default=s.base_model)
    parser.add_argument("--allow-partial", action="store_true", help="Score the labeled rows of files that aren't finished.")
    args = parser.parse_args()
    gold_dir = Path(args.gold)
    files_map = load_files_map(gold_dir)
    csvs = sorted(gold_dir.glob("*.csv"))
    if not csvs:
        print(f"No gold CSVs in {gold_dir}. Make them with scripts/make_gold.py, then fill in my_label.", file=sys.stderr)
        return 2

    items: list[Scored] = []
    notes: list[str] = []
    for path in csvs:
        try:
            gold = load_gold_csv(path)
        except GoldError as err:
            print(f"Not scored — fix this first:\n{err}", file=sys.stderr)
            return 2
        if gold.missing and not args.allow_partial:
            print(f"{path.name}: {len(gold.missing)} of {len(gold.rows)} layers have no my_label yet "
                  f"(e.g. {', '.join(gold.missing[:5])}). Fill them in, or use --allow-partial.", file=sys.stderr)
            return 2
        if gold.missing:
            notes.append(f"{path.name}: {len(gold.missing)} unlabeled layers left out")
        labeled = {r.layer_name: r for r in gold.rows if r.label is not None}
        if not labeled:
            continue
        drawing = files_map.get(path.stem)
        if not drawing:
            print(f"{path.name}: no drawing recorded in files.json", file=sys.stderr)
            return 2
        drawing_path = (ML / drawing) if not Path(drawing).is_absolute() else Path(drawing)
        summaries = summarize_file(drawing_path)
        print(f"labeling {drawing_path.name} ({len(summaries)} layers) with {args.model}, retrieval off…", flush=True)
        try:
            # Retrieval OFF: no bank, so no example from this or any other file reaches the prompt.
            results = classify_baseline(summaries, s, model=args.model, bank=None, retrieval_k=0)
        except (OllamaUnavailable, OllamaError) as err:
            print(err, file=sys.stderr)
            return 3
        for summary, r in zip(summaries, results):
            row = labeled.get(str(summary["name"]))
            if row is not None:
                items.append(Scored(path.stem, row.layer_name, int(summary.get("total", 0)), row.label or "", r.label, r.confidence))
        unseen = set(labeled) - {str(x["name"]) for x in summaries}
        if unseen:
            notes.append(f"{path.name}: {len(unseen)} labeled layers not in the drawing (renamed?): {', '.join(sorted(unseen)[:5])}")

    report = score(items)
    report.notes = notes
    (gold_dir / "report.json").write_text(json.dumps(asdict(report), indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n{report.caveat}\n")
    print(f"Accuracy by layer:            {report.accuracy_by_layer:.1%}  ({report.layers} layers)")
    print(f"Accuracy weighted by entities: {report.accuracy_by_entities:.1%}  ({report.entities} entities)")
    c = report.confidence
    if c["wrong_lower"] is not None:
        print(f"Confidence: right answers {c['right_mean']}, wrong answers {c['wrong_mean']} — "
              f"{'lower on wrong answers (good)' if c['wrong_lower'] else 'NOT lower on wrong answers'}")
    print(f"\n{'label':<12} {'layers':>6} {'by layer':>9} {'entities':>9} {'by entity':>10}")
    for label, v in report.per_label.items():
        print(f"{label:<12} {int(v['layers']):>6} {v['accuracy']:>9.1%} {int(v['entities']):>9} {v['accuracy_by_entities']:>10.1%}")
    print("\nPer file:")
    for f, v in report.per_file.items():
        print(f"  {f}: {v['accuracy']:.1%} by layer, {v['accuracy_by_entities']:.1%} by entities ({int(v['layers'])} layers)")
    print(f"\nWrong layers ({len(report.wrong)}), biggest first:")
    for w in report.wrong:
        print(f"  {w['entities']:>6}  {w['file']} / {w['layer']}: you said {w['gold']}, model said {w['predicted']} (p={w['confidence']})")
    if report.flags:
        print("\nFLAGGED — these would hurt the map most:")
        for f in report.flags:
            print(f"  {f['file']} / {f['layer']}: {f['gold']} → {f['predicted']}  [{'; '.join(f['why'])}]")
    for n in notes:
        print("note:", n)
    print(f"\nWritten: {gold_dir / 'report.json'}. Don't change the prompt or label guide from one file — collect mistakes across files first.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
