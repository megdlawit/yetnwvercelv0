"""Generate the map-editor assistant's training and test data.

    python scripts/make_assistant_data.py [--train 2500] [--test 300] [--out data/assistant]

Generated requests with answers correct by construction (see
yetnew_layers/assistant_data.py): train.jsonl and test.jsonl (whole phrasing
templates held out for testing), manifest.json. No customer data, so no legal
gate — but only English so far.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.assistant import spec  # noqa: E402
from yetnew_layers.assistant_data import generate  # noqa: E402
from yetnew_layers.config import load_settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--train", type=int, default=2500)
    parser.add_argument("--test", type=int, default=300)
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "data" / "assistant"))
    parser.add_argument("--fresh-test", metavar="NAME", help="Only write test_NAME.jsonl: a fresh draw of the held-out phrasings.")
    args = parser.parse_args()
    train, test, manifest = generate(args.train, args.test, num_ctx=load_settings().num_ctx, test_draw=args.fresh_test or "")
    if args.fresh_test:
        out = Path(args.out)
        with (out / f"test_{args.fresh_test}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for r in test:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"Wrote {len(test)} fresh test requests to {out / f'test_{args.fresh_test}.jsonl'} (same held-out phrasings, new draw).")
        return 0
    manifest["spec_version"] = spec()["version"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in (("train.jsonl", train), ("test.jsonl", test)):
        with (out / name).open("w", encoding="utf-8", newline="\n") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {len(train)} training and {len(test)} test requests to {out} "
          f"({manifest['templates']} phrasing templates, {len(manifest['held_out_templates'])} held out for testing).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
