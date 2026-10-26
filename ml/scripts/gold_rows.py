"""Training rows from the gold CSVs of drawings shared WITH training permission.

    python scripts/gold_rows.py --out data/gold_rows.json
    python scripts/export_dataset.py --gold --from-json data/gold_rows.json --out data/dataset

Only the drawings in TRAINING_PERMITTED (each recorded in data/SOURCES.md with the owner's
confirmation that the sender agreed) — never the downloaded test files, whose licences are
unknown. Each drawing is one "venue" for the whole-venue train/validation split.

The layer summaries are made again from the drawing with the service's own summarizer (the
same facts the model sees when labeling); the label is the gold CSV's my_label. Empty layers
are left out: the service labels them `ignore` without asking the model. Rows are marked
confirmed_via = "gold", which the dataset accepts only on this path (export_dataset --gold).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from yetnew_layers.summarize import summarize_file  # noqa: E402

GOLD = ML / "data" / "gold"

#: Gold CSV stems of drawings shared with permission for training (data/SOURCES.md).
TRAINING_PERMITTED = [
    "BELAY G+4 MAY 10.from-dwg",
    "10 ABAZASH LEMESA (1).from-dwg",
    "fortraining.from-dwg",
    "typical.from-dwg",
    "girum residence_AR.from-dwg",
    "G+6_Apartement_kebra.from-dwg",
    "edu _ G+5 Residence _ for permit 26 8 20.from-dwg",
    "AMARECH  TADESE(BETSEGAW).from-dwg",
    "Final Interior design project.from-dwg",
    "E ALL.from-dwg",
    "ETAGEGNEW SEMU   EL.from-dwg",
    "G+1 House Cad File.from-dwg",
    "G+2 With Terrace.from-dwg",
    # Marriott hotel: one DWG per floor (data/shared/marriott/), one project
    "AR_MARRIOTT HOTEL A-101_BASEMENT 2  FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-102_BASEMENT 1  FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-103_SEMI-BASEMENT FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-104_GROUND FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-105_MEZZANINE  FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-106_FIRST FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-107_SECOND FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-108_DUCT FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-109_THIRD FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-110_FORTH FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-111_5th,6th,7th,8th & 9th FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-113 ELEVENTH FLOOR PLAN JAN_26.from-dwg",
    "AR_MARRIOTT HOTEL A-114_ROOF PLAN JAN_26.from-dwg",
]

#: Drawings of one project share a venue, so the split never puts one in training and the
#: other in validation ("typical" is the G+6 apartment's typical floor).
SAME_PROJECT = {"typical.from-dwg": "G+6_Apartement_kebra.from-dwg",
                **{f"{n}.from-dwg": "Marriott hotel" for n in ['AR_MARRIOTT HOTEL A-101_BASEMENT 2  FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-102_BASEMENT 1  FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-103_SEMI-BASEMENT FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-104_GROUND FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-105_MEZZANINE  FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-106_FIRST FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-107_SECOND FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-108_DUCT FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-109_THIRD FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-110_FORTH FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-111_5th,6th,7th,8th & 9th FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-113 ELEVENTH FLOOR PLAN JAN_26', 'AR_MARRIOTT HOTEL A-114_ROOF PLAN JAN_26']}}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(ML / "data" / "gold_rows.json"))
    args = parser.parse_args()
    files = json.loads((GOLD / "files.json").read_text(encoding="utf-8"))
    rows: list[dict] = []
    for stem in TRAINING_PERMITTED:
        drawing = ML / files.get(stem, f"data/shared/{stem}.dxf")
        if not drawing.exists():
            drawing = ML / "data" / "shared" / "marriott" / f"{stem}.dxf"
        labels = {r["layer_name"]: r["my_label"].strip()
                  for r in csv.DictReader((GOLD / f"{stem}.csv").open(encoding="utf-8-sig"))}
        venue = "gold-" + hashlib.sha256(SAME_PROJECT.get(stem, stem).encode()).hexdigest()[:12]   # opaque, stable
        kept = 0
        for summary in summarize_file(drawing):
            label = labels.get(summary["name"], "")
            if summary["total"] == 0 or not label:
                continue
            rows.append({"building_id": venue, "layer_name": summary["name"], "final_label": label,
                         "confirmed_via": "gold", "layer_summary": summary, "file_name": drawing.name,
                         "created_at": "2026-10-24T00:00:00Z"})
            kept += 1
        print(f"{stem}: {kept} layers with content")
    Path(args.out).write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}: {len(rows)} rows from {len(TRAINING_PERMITTED)} drawings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
