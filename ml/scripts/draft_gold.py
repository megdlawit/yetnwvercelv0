"""Draft the my_label column of gold CSVs, for a person to check (never final on its own).

    python scripts/draft_gold.py            # every drawing listed in data/gold/where/list.txt

Signals per layer: where it is (share of its items inside the floor plans the editor's
import finds — data/gold/where/<drawing>.json, written by the editor's scratch runner),
what it holds (the summary's entity types), and the editor's name rules (with confidence).
The question is the gold README's: what should this layer become on the FLOOR map? A layer
drawn only in elevations, sections or the site plan is `ignore`, whatever its name.

Fills empty my_label cells only (never overwrites a label someone wrote), and writes
data/gold/REVIEW_drafts_<date>.csv: drawing, layer, count, draft, sure, why. Rows marked
`?` are the ones a person must look at; the others are drafts a person can skim.
"""

from __future__ import annotations

import csv
import datetime
import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))
from yetnew_layers.gold import load_gold_csv  # noqa: E402,F401  (keeps the CSV contract in one place)

GOLD = ML / "data" / "gold"
CATEGORY_TO_LABEL = {
    "walls": "wall", "doors": "door", "windows": "window", "stairs": "stairs", "elevators": "elevator",
    "rooms": "room", "furniture": "furniture", "trees": "vegetation", "labels": "text", "ignore": "ignore",
}


def types_of(summary: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for part in (summary or "").split(";"):
        bits = part.strip().rsplit(" ", 1)
        if len(bits) == 2 and bits[1].isdigit():
            out[bits[0]] = int(bits[1])
    return out


def draft(row: dict[str, str], where: dict) -> tuple[str, bool, str]:
    name = row["layer_name"]
    count = int(row.get("entity_count") or 0)
    if count == 0:
        return "ignore", True, "empty layer"
    kinds = types_of(row.get("entity_type_summary", ""))
    shown = sum(kinds.values()) or 1
    share = lambda *ks: sum(kinds.get(k, 0) for k in ks) / shown  # noqa: E731
    lay = where["layers"].get(name, {"total": 0, "inPlan": 0})
    hat = where["hatch"].get(name, {"total": 0, "inPlan": 0})
    total = lay["total"] + hat["total"]
    inside = (lay["inPlan"] + hat["inPlan"]) / total if total else None
    rule = where["rules"].get(name)
    rule_label = CATEGORY_TO_LABEL.get(rule[0], "unknown") if rule else None
    rule_conf = rule[1] if rule else 0.0

    if share("DIMENSION") >= 0.5:
        return "dimension", True, "mostly dimensions"
    if inside is not None and inside < 0.15:
        return "ignore", count >= 5, f"{100 * inside:.0f}% inside the floor plans: elevations, sections or site only"
    if share("HATCH") >= 0.6:
        sure = rule_label in (None, "ignore")
        return "ignore", sure, "mostly hatching" + ("" if sure else f" (the name says {rule_label})")
    if share("TEXT", "MTEXT") >= 0.7:
        if inside is None or inside >= 0.5:
            return "text", True, "texts inside the plans (names, labels)"
        return "text", False, f"texts, {100 * inside:.0f}% inside the plans — names or sheet notes?"
    where_note = "" if inside is None else f"{100 * inside:.0f}% inside the plans; "
    if rule_label and rule_conf >= 0.9:
        return rule_label, inside is None or inside >= 0.5, f"{where_note}name rule: {rule[2]}"
    if rule_label:
        return rule_label, False, f"{where_note}weak name rule ({rule_conf:.2f}): {rule[2]}"
    return "unknown", False, f"{where_note}no rule — the reader skips these entity types"


def main() -> int:
    names = [n for n in (GOLD / "where" / "list.txt").read_text(encoding="utf-8").splitlines() if n.strip()]
    review: list[dict[str, str]] = []
    for name in names:
        csv_path = GOLD / f"{name}.from-dwg.csv"
        where = json.loads((GOLD / "where" / f"{name}.json").read_text(encoding="utf-8"))
        with csv_path.open(encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            fields = reader.fieldnames
            rows = list(reader)
        filled = unsure = 0
        for row in rows:
            if row.get("my_label", "").strip():
                continue
            label, sure, why = draft(row, where)
            row["my_label"] = label
            filled += 1
            if int(row.get("entity_count") or 0) > 0:
                unsure += not sure
                review.append({"drawing": name, "layer_name": row["layer_name"], "entity_count": row["entity_count"],
                               "draft_label": label, "sure": "" if sure else "?", "why": why})
        with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        print(f"{name}: {filled} drafted, {unsure} to check")
    out = GOLD / f"REVIEW_drafts_{datetime.date.today():%Y-%m-%d}.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["drawing", "layer_name", "entity_count", "draft_label", "sure", "why"])
        writer.writeheader()
        writer.writerows(sorted(review, key=lambda r: (r["sure"] != "?", r["drawing"], -int(r["entity_count"]))))
    print(f"wrote {out}: {len(review)} layers with content, {sum(r['sure'] == '?' for r in review)} marked ?")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
