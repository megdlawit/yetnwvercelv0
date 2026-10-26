"""Compare baseline, baseline + retrieved examples, and the fine-tuned model —
THROUGH OLLAMA — on the frozen held-out venues of an export.

    python scripts/evaluate.py --dataset data/dataset                 # report only
    python scripts/evaluate.py --dataset data/dataset --write         # also write model_choice.json, if allowed

Before --write: `python scripts/check_template.py --model <fine-tuned>` must
have passed on this Ollama version for the model as installed now.

The fine-tuned model replaces the service's current mode (baseline, or
retrieval when YETNEW_RETRIEVAL_K > 0) only if it is 3+ points better, the
95% venue-bootstrap interval of the difference is above 0, and wall /
walkable / ignore don't get worse. model_choice.json is written only with
--write, real data, >= 3 held-out venues, >= 100 layers, >= 10 per label,
the current prompt version and text setting, and a current template check.
Reports go to <dataset>/eval_report.json either way.

Retrieval is a headline number only when every example it showed came from a
different venue than the layer being scored (checked per example, and said in
the output); otherwise it is printed as "diagnostic only" and compared with nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.config import load_settings  # noqa: E402
from yetnew_layers.evaluate import (  # noqa: E402
    MIN_VAL_LAYERS,
    MIN_VAL_PER_LABEL,
    MIN_VAL_VENUES,
    Comparison,
    Report,
    choice_record,
    compare,
    decide,
    load_val,
    per_label_table,
    report_dict,
    run,
)
from yetnew_layers.models import _installed  # noqa: E402
from yetnew_layers.ollama import OllamaError, OllamaUnavailable, list_models  # noqa: E402
from yetnew_layers.retrieval import ExampleBank  # noqa: E402
from yetnew_layers.template_check import status as template_status  # noqa: E402


def show(r: Report) -> None:
    print(f"  {r.kind:<10} {r.model:<40} {r.correct:>4}/{r.n:<4} = {r.accuracy:.1%}   ({r.seconds:.0f} s)")
    if r.note:
        print(f"             {r.note}")
    if r.confusions:
        print("             commonest mistakes (expected → got): " + ", ".join(f"{a}→{b} ×{k}" for a, b, k in r.confusions[:6]))


def show_comparison(c: Comparison) -> None:
    print(f"  {c.challenger} vs {c.reference}: {c.difference:+.1%} (95% CI {c.ci_low:+.1%} … {c.ci_high:+.1%})  "
          f"margin {'ok' if c.margin_ok else 'NO'} · interval {'ok' if c.ci_ok else 'NO'} · "
          f"regressions {', '.join(c.regressions) or 'none'}  →  {'WINS' if c.wins else 'does not win'}")


def main() -> int:
    s = load_settings()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", required=True, help="Folder written by export_dataset.py")
    parser.add_argument("--baseline", default=s.base_model)
    parser.add_argument("--finetuned", default=s.finetuned_model)
    parser.add_argument("--retrieval-k", type=int, default=s.retrieval_k or 3, help="Examples per layer for the retrieval option (0 = skip it).")
    parser.add_argument("--write", action="store_true", help="Write model_choice.json if every requirement is met.")
    parser.add_argument("--baseline-only", action="store_true",
                        help="Score only the baseline (and retrieval): the number a fine-tuned model must beat. Chooses nothing.")
    args = parser.parse_args()

    if "smoke" in args.finetuned.lower():
        print(f"{args.finetuned} is a notebook smoke-test model: it is never evaluated or used. Delete it (`ollama rm {args.finetuned}`).",
              file=sys.stderr)
        return 2
    dataset = Path(args.dataset)
    manifest, rows = load_val(dataset)
    if manifest.get("synthetic"):
        print("SYNTHETIC DRY RUN — results say nothing about real accuracy; model_choice.json will not be written.")
    try:
        names = list_models(s.ollama_url)
    except (OllamaUnavailable, OllamaError) as err:
        print(err, file=sys.stderr)
        return 3
    missing = [m for m in ((args.baseline,) if args.baseline_only else (args.baseline, args.finetuned)) if not _installed(names, m)]
    if missing:
        print(f"Not installed in Ollama: {', '.join(missing)}", file=sys.stderr)
        return 3
    bank_path = dataset / "example_bank.jsonl"
    bank = ExampleBank.load(bank_path) if bank_path.exists() and args.retrieval_k > 0 else None

    print(f"{len(rows)} held-out layers from {len(manifest['venues']['val'])} venue(s); to choose a model: "
          f">= {MIN_VAL_VENUES} venues, >= {MIN_VAL_LAYERS} layers, >= {MIN_VAL_PER_LABEL} per label")
    reports = run(rows, s, baseline_model=args.baseline, finetuned_model=None if args.baseline_only else args.finetuned, bank=bank, retrieval_k=args.retrieval_k)
    if args.baseline_only:
        print("\nThe score to beat (no fine-tuned model compared, nothing chosen)")
        for kind, r in reports.items():
            show(r)
        (dataset / "baseline_report.json").write_text(json.dumps({k: v.__dict__ for k, v in reports.items()}, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        return 0
    reference = "retrieval" if s.retrieval_k > 0 and "retrieval" in reports else "baseline"
    template = template_status(s, args.finetuned)
    decision = decide(manifest, rows, reports, reference=reference, template=template)

    print("\nOverall")
    for kind, r in reports.items():
        if kind != "retrieval_diagnostic":
            show(r)
    if "retrieval_diagnostic" in reports:
        # Never a headline number: some examples came from the venue being scored.
        r = reports["retrieval_diagnostic"]
        print(f"\nDiagnostic only (not a result, used in no comparison)\n  {r.model}: {r.note}")
    print(f"\nPer label (reference = {reference}; ▼ = fine-tuned worse on a no-regression label) — review these:")
    print("\n".join(per_label_table(reports, reference)))
    print("\nSwitch rule")
    show_comparison(decision.comparison)
    # Reasons that make ANY conclusion from this data premature (not the fine-tuned model's template check).
    insufficient = [r for r in decision.reasons if not r.startswith("template check")]
    if "retrieval" in reports and reference == "baseline":
        rc = compare(rows, reports["retrieval"], reports["baseline"])
        show_comparison(rc)
        if rc.wins and insufficient:
            print("  → not a recommendation: this data can't support a decision (see below).")
        elif rc.wins:
            print(f"  → retrieval passes the same rule against the baseline; consider YETNEW_RETRIEVAL_K={args.retrieval_k}.")

    (dataset / "eval_report.json").write_text(json.dumps(report_dict(reports, decision), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWinner on this data: {decision.winner}")
    if not decision.can_write:
        print("model_choice.json NOT written:\n  - " + "\n  - ".join(decision.reasons))
        return 0
    if not args.write:
        print("Every requirement is met. Review the per-label table, then re-run with --write to record the choice.")
        return 0
    record = choice_record(manifest, reports, decision, retrieval_k=args.retrieval_k)
    s.choice_file.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(f"Wrote {s.choice_file}: the service will use {'the fine-tuned model' if decision.winner == 'finetuned' else 'its current mode'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
