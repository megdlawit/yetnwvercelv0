"""Write blank gold CSVs (my_label empty) for drawings you will label by hand.

    python scripts/make_gold.py data/smoke/<drawing>.dxf [more.dxf …] [--out data/gold]

Refuses to overwrite a CSV that already has labels in it. Records which
drawing each CSV belongs to in <out>/files.json. Test files only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.gold import GoldError, load_gold_csv, write_gold_csv  # noqa: E402
from yetnew_layers.summarize import summarize_file  # noqa: E402

ML = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("drawings", nargs="+")
    parser.add_argument("--out", default=str(ML / "data" / "gold"))
    args = parser.parse_args()
    out = Path(args.out)
    files_map_path = out / "files.json"
    files_map = json.loads(files_map_path.read_text(encoding="utf-8")) if files_map_path.exists() else {}
    for name in args.drawings:
        drawing = Path(name).resolve()
        if "synthetic" in drawing.name.lower():
            print(f"skipped {drawing.name}: the synthetic fixture is not a real drawing")
            continue
        csv_path = out / f"{drawing.stem}.csv"
        if csv_path.exists():
            try:
                existing = load_gold_csv(csv_path)
            except GoldError:
                existing = None
            if existing is None or len(existing.missing) < len(existing.rows):
                print(f"kept {csv_path.name}: it already has labels (delete it yourself to start over)")
                continue
        summaries = summarize_file(drawing)
        write_gold_csv(summaries, csv_path)
        try:
            files_map[csv_path.stem] = str(drawing.relative_to(ML)).replace("\\", "/")
        except ValueError:
            files_map[csv_path.stem] = str(drawing)
        print(f"wrote {csv_path} — {len(summaries)} layers, my_label empty")
    out.mkdir(parents=True, exist_ok=True)
    files_map_path.write_text(json.dumps(files_map, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
