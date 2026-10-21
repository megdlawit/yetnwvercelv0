"""Evaluate the map-editor assistant through Ollama on held-out phrasings.

    python scripts/eval_assistant.py [--data data/assistant] [--limit 60]                 # base model only
    python scripts/eval_assistant.py --finetuned yetnew-assistant [--write]               # base vs fine-tuned
    python scripts/eval_assistant.py --examples 4 [--limit 60]                            # base vs base + worked examples

Reports exact-match accuracy (the whole action list right), action-type
accuracy, valid answers, per-action results and every mistake. With
--finetuned it applies the switch rule (5+ points, 95% interval above 0, no
drop on asking-back or destructive actions) and, with --write and enough test
requests and a current template check, writes assistant_choice.json — the only
way the service starts using the fine-tuned assistant.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.assistant import ASSISTANT_CHOICE_FILE, FINETUNED_SCHEMA, ExampleBank, ask, spec  # noqa: E402
from yetnew_layers.assistant_eval import AnswerCache, AssistantReport, decide, report_dict, run_model  # noqa: E402
from yetnew_layers.config import load_settings  # noqa: E402
from yetnew_layers.ollama import OllamaError, OllamaUnavailable, model_digest  # noqa: E402
from yetnew_layers.template_check import status as template_status  # noqa: E402


def show(r: AssistantReport) -> None:
    print(f"\n{r.model}: exact {r.exact:.1%} · right action types {r.ops:.1%} · valid {r.valid:.1%}  ({r.n} requests, {r.seconds:.0f} s)")
    print("  " + "  ".join(f"{op} {v['exact']:.0%}/{int(v['n'])}" for op, v in r.per_op.items()))


def main() -> int:
    s = load_settings()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default=str(Path(__file__).resolve().parents[1] / "data" / "assistant"))
    parser.add_argument("--base", default=s.assistant_model)
    parser.add_argument("--finetuned", help="Also evaluate this model and apply the switch rule.")
    parser.add_argument("--limit", type=int, default=0, help="Only the first N test requests (CPU time!).")
    parser.add_argument("--examples", type=int, default=0, help="Also score the base model with worked examples (K for nearest; any K>0 for menu).")
    parser.add_argument("--example-mode", choices=["menu", "nearest"], default="menu")
    parser.add_argument("--test-file", default="test.jsonl", help="Which test file in --data (e.g. a fresh draw).")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--fresh", action="store_true", help="Ignore saved answers (answers.jsonl) and ask everything again.")
    args = parser.parse_args()

    data = Path(args.data)
    rows = [json.loads(line) for line in (data / args.test_file).read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.limit:
        rows = rows[: args.limit]
    manifest = json.loads((data / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("spec_version") != spec()["version"]:
        print("The test data was generated for another spec version — run make_assistant_data.py again.", file=sys.stderr)
        return 2
    if args.finetuned and "smoke" in args.finetuned.lower():
        print(f"{args.finetuned} is a notebook smoke-test model; delete it (`ollama rm {args.finetuned}`).", file=sys.stderr)
        return 2

    def asker(body: dict, model: str) -> dict:
        return ask(body, s, model)

    def asker_finetuned(body: dict, model: str) -> dict:
        return ask(body, s, model, schema=FINETUNED_SCHEMA)

    bank = None
    if args.examples > 0:
        bank = ExampleBank.load(data / "train.jsonl")
        # Examples come from the training phrasings only: none from a held-out (test) phrasing.
        leaked = bank.templates() & {r["template"] for r in rows}
        if leaked:
            print(f"Example bank contains test phrasings {sorted(leaked)[:5]} — regenerate the data.", file=sys.stderr)
            return 2

    def asker_examples(body: dict, model: str) -> dict:
        return ask(body, s, model, bank=bank, examples_k=args.examples, examples_mode=args.example_mode)

    # Every answer is saved as it arrives: an interrupted run resumes where it stopped.
    cache = AnswerCache(None if args.fresh else data / "answers.jsonl")

    def progress(msg: str) -> None:
        print(f"\r  {msg}   ", end="", flush=True)

    def run(model: str, ask_fn, setup: str) -> AssistantReport:
        r = run_model(rows, model, ask_fn, cache=cache, setup=f"{setup}|spec{spec()['version']}", progress=progress)
        print(flush=True)
        return r

    try:
        reports = {"base": run(args.base, asker, args.base)}
        if bank is not None:
            label = "menu" if args.example_mode == "menu" else f"{args.examples}nearest"
            reports["examples"] = run(args.base, asker_examples, f"{args.base}+{args.examples}examples" if label != "menu" else f"{args.base}+menu")
            reports["examples"].model = f"{args.base} + worked examples ({'one per action' if label == 'menu' else f'{args.examples} nearest'})"
        if args.finetuned:
            # Asked the way the service asks it; answers saved per model build (digest) and mode
            # ("free" = no schema), so a retrained model with the same name is asked again.
            digest = (model_digest(s.ollama_url, args.finetuned) or "unknown").removeprefix("sha256:")[:12]
            reports["finetuned"] = run(args.finetuned, asker_finetuned,
                                       f"{args.finetuned}@{digest}" + ("" if FINETUNED_SCHEMA else "+free"))
    except (OllamaUnavailable, OllamaError) as err:
        print(err, file=sys.stderr)
        return 3
    for r in reports.values():
        show(r)
    print(f"\nMistakes of {args.base} (first 25):")
    for m in reports["base"].mistakes[:25]:
        print(f"  [{m['template']}] {m['text']!r}\n     want {m['want']}\n     got  {m['got']} {('reply: ' + repr(m['reply'])) if m['reply'] else ''}")

    out = {k: report_dict(v) for k, v in reports.items()}
    if "examples" in reports:
        print(f"\nWorked examples came only from training phrasings ({len(bank.templates()) if bank else 0} templates); "
              f"none of the {len({r['template'] for r in rows})} test phrasings.")
        d = decide(rows, reports["base"], reports["examples"], template=(True, ""))
        out["examples_decision"] = d.__dict__
        print(f"base + examples vs base: {d.difference:+.1%} (95% CI {d.ci[0]:+.1%} … {d.ci[1]:+.1%}), "
              f"regressions {', '.join(d.regressions) or 'none'} → "
              + ("passes the switch rule: consider YETNEW_ASSISTANT_EXAMPLES=" + str(args.examples) if d.winner == "finetuned" and len(rows) >= 200
                 else "passes on this sample, but run 200+ requests before switching" if d.winner == "finetuned"
                 else "does not pass the switch rule"))
    if args.finetuned:
        d = decide(rows, reports["base"], reports["finetuned"], template=template_status(s, args.finetuned))
        out["decision"] = d.__dict__
        print(f"\nfine-tuned vs base: {d.difference:+.1%} (95% CI {d.ci[0]:+.1%} … {d.ci[1]:+.1%}), "
              f"regressions {', '.join(d.regressions) or 'none'} → winner: {d.winner}")
        if not d.can_write:
            print("assistant_choice.json NOT written: " + "; ".join(d.reasons))
        elif args.write:
            ASSISTANT_CHOICE_FILE.write_text(json.dumps({"winner": d.winner, "finetuned_model": args.finetuned, "base_model": args.base,
                                                         "spec_version": spec()["version"], "finetuned_schema": FINETUNED_SCHEMA, "exact": {k: v.exact for k, v in reports.items()},
                                                         "difference": d.difference, "ci95": list(d.ci)}, indent=2), encoding="utf-8")
            print(f"Wrote {ASSISTANT_CHOICE_FILE.name}: the service will use {'the fine-tuned' if d.winner == 'finetuned' else 'the base'} assistant.")
    (data / "eval_report.json").write_text(json.dumps(out, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\nTest requests: {len(rows)} (phrasings never seen in training). Generated English data only — real conversations will differ.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
