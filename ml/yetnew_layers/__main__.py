"""Command line:

    python -m yetnew_layers summarize plan.dxf
    python -m yetnew_layers classify plan.dxf [--model qwen2.5:3b]
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from .classify import classify_baseline
from .config import load_settings
from .ollama import OllamaError, OllamaUnavailable
from .summarize import DxfReadError, summarize_file


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="yetnew_layers", description="Label the layers of a DXF with a local model.")
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("summarize", help="Print each layer's summary (what the model sees).")
    s.add_argument("dxf")
    c = sub.add_parser("classify", help="Label each layer with the baseline model.")
    c.add_argument("dxf")
    c.add_argument("--model", help="Ollama model (default: YETNEW_BASE_MODEL or qwen2.5:7b).")
    args = parser.parse_args(argv)

    try:
        summaries = summarize_file(args.dxf)
    except DxfReadError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    if args.command == "summarize":
        print(json.dumps(summaries, ensure_ascii=False, indent=2))
        return 0

    settings = load_settings()
    started = time.perf_counter()
    try:
        results = classify_baseline(summaries, settings, model=args.model)
    except (OllamaUnavailable, OllamaError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 3
    print(json.dumps([r.to_dict() for r in results], ensure_ascii=False, indent=2))
    review = sum(r.needs_review for r in results)
    print(f"{len(results)} layers, {review} need review, {time.perf_counter() - started:.1f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
