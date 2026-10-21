"""Inventory of local test drawings: is a DXF usable as a labeling test file?

    python scripts/inventory_dxf.py data/smoke/*.dxf [--json data/inventory.json]

Per file: size, DXF version, units, layer count (in the table / actually
used), entity count (model space, plus paper space), share of entities on
layer "0", top entity types, blocks and texts, and signals that it is an
architectural floor plan (layer names, door/stair/toilet blocks, room words,
plan size in metres). These are hints for a person to decide — not a verdict.

Test files are never training data (see README §4.6).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.summarize import DxfReadError, read_dxf  # noqa: E402

UNITS = {0: "unitless", 1: "inches", 2: "feet", 4: "mm", 5: "cm", 6: "m"}
PER_METRE = {1: 39.3701, 2: 3.28084, 4: 1000.0, 5: 100.0, 6: 1.0}
LAYER_SIGNAL = re.compile(r"WALL|DOOR|WIND|GLAZ|STAIR|STRS|ELEV|LIFT|ROOM|AREA|FURN|TOILET|WC|PLUMB|COL|AXIS|GRID|DIM|^A-|^I-|^S-", re.I)
BLOCK_SIGNAL = re.compile(r"DOOR|DR|WIND|STAIR|WC|TOILET|URINAL|SINK|BASIN|CHAIR|TABLE|BED|SOFA", re.I)
ROOM_WORDS = re.compile(r"\b(ROOM|HALL|LOBBY|KITCHEN|BATH|TOILET|WC|BED|LIVING|OFFICE|STORE|CORRIDOR|ENTRANCE|STAIR|LIFT|M2|M²|SQ)\b", re.I)


def inspect(path: Path) -> dict[str, Any]:
    doc = read_dxf(path)
    msp = doc.modelspace()
    layers_table = [layer.dxf.name for layer in doc.layers]
    by_layer: Counter[str] = Counter()
    types: Counter[str] = Counter()
    blocks: Counter[str] = Counter()
    texts: list[str] = []
    for e in msp:
        by_layer[e.dxf.get("layer", "0")] += 1
        types[e.dxftype()] += 1
        if e.dxftype() == "INSERT":
            blocks[e.dxf.name] += 1
        elif e.dxftype() in ("TEXT", "MTEXT") and len(texts) < 400:
            t = e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.get("text", "")
            if t and t.strip():
                texts.append(" ".join(t.split())[:40])
    paper = sum(len(layout) for layout in doc.layouts if layout.name != "Model")
    total = sum(by_layer.values())
    units = int(doc.header.get("$INSUNITS", 0) or 0)
    ext_min, ext_max = doc.header.get("$EXTMIN"), doc.header.get("$EXTMAX")
    size_m = None
    if ext_min and ext_max and units in PER_METRE:
        w, h = abs(ext_max[0] - ext_min[0]), abs(ext_max[1] - ext_min[1])
        if w < 1e12 and h < 1e12:
            size_m = (round(w / PER_METRE[units], 1), round(h / PER_METRE[units], 1))
    used = [name for name, n in by_layer.items() if n > 0]
    return {
        "file": path.name,
        "size_kb": round(path.stat().st_size / 1024),
        "dxf_version": doc.dxfversion,
        "units": UNITS.get(units, f"code {units}"),
        "plan_size_m": size_m,
        "layers_in_table": len(layers_table),
        "layers_used": len(used),
        "entities_model": total,
        "entities_paper": paper,
        "share_on_layer_0": round(by_layer.get("0", 0) / total, 3) if total else None,
        "top_layers": by_layer.most_common(6),
        "top_types": types.most_common(6),
        "blocks": len(blocks), "top_blocks": [b for b, _ in blocks.most_common(8)],
        "texts": len(texts), "text_samples": texts[:8],
        "signals": {
            "plan_like_layer_names": sorted({n for n in used if LAYER_SIGNAL.search(n)})[:12],
            "plan_like_blocks": sorted({b for b in blocks if BLOCK_SIGNAL.search(b)})[:8],
            "room_words_in_text": sorted({m.group(0).upper() for t in texts for m in ROOM_WORDS.finditer(t)})[:10],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+")
    parser.add_argument("--json", help="Also write the inventory as JSON here.")
    args = parser.parse_args()
    out = []
    for name in args.files:
        try:
            info = inspect(Path(name))
        except DxfReadError as err:
            info = {"file": Path(name).name, "error": str(err)}
        out.append(info)
        print(json.dumps(info, ensure_ascii=False))
    if args.json:
        Path(args.json).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
