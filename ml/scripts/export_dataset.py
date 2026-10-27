"""Export reviewed layer labels as a training set (whole-venue split).

DISABLED for customer venues until the consent notice has had legal review:
then set YETNEW_LEGAL_REVIEWED_NOTICE_VERSION to the notice's version (1).

From Supabase — only rows confirmed individually or by group, on venues whose
training consent is accepted now (the database function enforces this):

    # a platform admin's session token (Supabase dashboard → or the app's localStorage)
    $env:SUPABASE_URL = "https://<project>.supabase.co"
    $env:SUPABASE_ANON_KEY = "<publishable key>"
    $env:YETNEW_ADMIN_TOKEN = "<access token of a platform admin>"
    python scripts/export_dataset.py --out data/dataset

    # or the service-role key (keep it on this machine only)
    $env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"

From a JSON file of rows in the same shape (offline / tests):

    python scripts/export_dataset.py --from-json rows.json --out data/dataset

Pipeline test on the synthetic fixture ONLY (output marked synthetic; the
notebook and evaluate.py refuse it for training or approval):

    python tests/fixtures/make_synthetic_export.py
    python scripts/export_dataset.py --from-json data/synthetic_export.json --synthetic-dry-run --out data/dataset-SYNTHETIC

Held-out venues are FROZEN in heldout/venues.json (venue ids only; it only
grows): a venue keeps its train/validation split in every later export.
The synthetic dry run uses its own registry inside the output folder.

Prints the label counts per split and the data-quality warnings.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.dataset import (  # noqa: E402
    HELDOUT_FILE,
    LEGAL_REVIEW_ENV,
    DatasetError,
    build_dataset,
    legal_review_confirmed,
    load_registry,
    save_registry,
    write_dataset,
)
from yetnew_layers.prompt import INCLUDE_TEXT_SAMPLES  # noqa: E402

PAGE = 1000  # PostgREST's default row limit


def fetch_rows() -> list[dict[str, Any]]:
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
    admin = os.environ.get("YETNEW_ADMIN_TOKEN")
    if not url or not (service or (anon and admin)):
        raise SystemExit("Set SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY + YETNEW_ADMIN_TOKEN.")
    headers = {"apikey": service or anon or "", "Authorization": f"Bearer {service or admin}", "Content-Type": "application/json"}
    rows: list[dict[str, Any]] = []
    while True:
        resp = httpx.post(
            f"{url}/rest/v1/rpc/layer_label_training_rows",
            params={"limit": PAGE, "offset": len(rows)},
            json={"include_texts": INCLUDE_TEXT_SAMPLES},
            headers=headers, timeout=60,
        )
        if resp.status_code != 200:
            raise SystemExit(f"Supabase answered {resp.status_code}: {resp.text[:300]}")
        page = resp.json()
        rows.extend(page)
        if len(page) < PAGE:
            return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from-json", help="Rows as returned by layer_label_training_rows(), instead of Supabase.")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "data" / "dataset"))
    parser.add_argument("--seed", default="yetnew", help="Order in which NEW venues are considered for holding out (deterministic).")
    parser.add_argument("--augment", type=int, default=1, help="Name-spelling variants per training layer (0 = none).")
    parser.add_argument("--generic-names", type=int, default=0,
                        help="Copies of each training layer under a meaningless name (Layer 3, 0, New Layer) — teaches judging by "
                             "content, as uploads from non-architects need. Experimental: compare with evaluate.py.")
    parser.add_argument("--ignore-ratio", type=float, default=None,
                        help="Keep at most this many 'ignore' training layers per other layer (e.g. 1.0: as many as all others). "
                             "Round 1 learned to answer 'ignore'. Validation is never changed.")
    parser.add_argument("--min-per-label", type=int, default=0,
                        help="Top up each rare label to this many training examples with copies under other names (same content).")
    parser.add_argument("--synthetic-dry-run", action="store_true", help="Allow the SYNTHETIC fixture (pipeline test only).")
    parser.add_argument("--gold", action="store_true",
                        help="Rows from scripts/gold_rows.py (drawings shared with training permission, not customer venues): "
                             "every row must be confirmed_via=gold; the customer consent check does not apply.")
    args = parser.parse_args()

    if args.gold and not args.from_json:
        print("--gold needs --from-json with the rows from scripts/gold_rows.py.", file=sys.stderr)
        return 2
    if not args.synthetic_dry_run and not args.gold and not legal_review_confirmed():
        print(f"Not exported: customer venues can't be exported until the consent notice has had legal review "
              f"(then set {LEGAL_REVIEW_ENV}=1).", file=sys.stderr)
        return 2
    rows = json.loads(Path(args.from_json).read_text(encoding="utf-8")) if args.from_json else fetch_rows()
    # The gold path takes only gold rows; customer rows (without legal review) never go through it.
    if args.gold and any(r.get("confirmed_via") != "gold" for r in rows):
        print("Not exported: --gold takes only rows from scripts/gold_rows.py (confirmed_via=gold).", file=sys.stderr)
        return 2
    if not args.gold and any(r.get("confirmed_via") == "gold" for r in rows):
        print("Not exported: gold rows go through --gold, not mixed with customer rows.", file=sys.stderr)
        return 2
    out = Path(args.out)
    if args.synthetic_dry_run and "synthetic" not in out.name.lower():
        out = out.with_name(out.name + "-SYNTHETIC")
    registry_path = out / "heldout_registry.json" if args.synthetic_dry_run else HELDOUT_FILE
    try:
        ds = build_dataset(rows, registry=load_registry(registry_path), seed=args.seed,
                           augment_copies=args.augment, generic_name_copies=args.generic_names,
                           allow_synthetic=args.synthetic_dry_run, ignore_ratio=args.ignore_ratio, min_per_label=args.min_per_label)
    except DatasetError as err:
        print(f"Not exported: {err}", file=sys.stderr)
        return 2
    manifest = write_dataset(ds, out, balance={"ignore_ratio": args.ignore_ratio, "min_per_label": args.min_per_label})
    save_registry(registry_path, ds.registry)  # only after a successful export; it only grows

    print(f"{'SYNTHETIC DRY RUN — never train on this. ' if ds.synthetic else ''}Wrote {out}")
    print(f"venues: {len(ds.train_venues)} train, {len(ds.val_venues)} validation (whole venues, frozen in {registry_path.name})")
    print(f"examples: {manifest['examples']['train']} train ({manifest['examples']['train_augmented']} augmented), {manifest['examples']['val']} validation")
    print(f"text samples: {'included' if INCLUDE_TEXT_SAMPLES else 'left out'}")
    print(f"\n{'label':<12} {'train':>6} {'+copies':>8} {'val':>5}")
    for label, n in manifest["label_counts"]["train"].items():
        print(f"{label:<12} {n:>6} {manifest['label_counts']['train_all'][label]:>8} {manifest['label_counts']['val'][label]:>5}")
    for reason, n in ds.dropped.items():
        print(f"dropped {n}: {reason}")
    for w in ds.warnings:
        print(f"WARNING: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
