"""SYNTHETIC test fixture — NOT a real venue. NEVER use it for training.

Builds `SYNTHETIC_architect_plan.dxf`: a small floor plan laid out the way an
architect's file usually is (AIA/NCS layer names, door and furniture blocks,
room tags, dimensions, a title block), plus the ambiguous and junk layers
real files carry. Its expected labels are in `SYNTHETIC_expected_labels.json`
— for smoke tests and for trying the review UI, not for measuring accuracy.

Every file it writes says SYNTHETIC in its name, and the drawing's own header
says so too ($PROJECTNAME). export_dataset refuses any file named like this.

    python tests/fixtures/make_synthetic.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import ezdxf
from ezdxf.document import Drawing

HERE = Path(__file__).parent
DXF_NAME = "SYNTHETIC_architect_plan.dxf"
LABELS_NAME = "SYNTHETIC_expected_labels.json"

#: What each layer should be labeled. Ambiguous layers are "unknown" on purpose:
#: a good labeler asks the admin about them rather than guessing.
EXPECTED: dict[str, str] = {
    "A-WALL": "wall",
    "A-WALL-PATT": "ignore",
    "A-DOOR": "door",
    "A-GLAZ": "window",
    "A-FLOR-STRS": "stairs",
    "A-FLOR-EVTR": "elevator",
    "A-AREA": "room",
    "A-AREA-IDEN": "text",
    "WC": "restroom",
    "I-FURN": "furniture",
    "L-PLNT": "vegetation",
    "C-WALK": "walkable",
    "A-ANNO-DIMS": "dimension",
    "A-ANNO-TTLB": "ignore",
    "Defpoints": "ignore",
    "0": "unknown",
    "Layer3": "unknown",
    "NEW": "unknown",
}


def _blocks(doc: Drawing) -> None:
    door = doc.blocks.new("DOOR-SGL-900")
    door.add_line((0, 0), (900, 0))
    door.add_arc((0, 0), 900, 0, 90)
    win = doc.blocks.new("WIN-1200")
    win.add_line((0, 0), (1200, 0))
    win.add_line((0, 100), (1200, 100))
    lift = doc.blocks.new("LIFT-CAR-1100")
    lift.add_lwpolyline([(0, 0), (1100, 0), (1100, 1400), (0, 1400)], close=True)
    lift.add_line((0, 0), (1100, 1400))
    stair = doc.blocks.new("STAIR-TREAD")
    stair.add_line((0, 0), (1200, 0))
    chair = doc.blocks.new("CHAIR-01")
    chair.add_lwpolyline([(0, 0), (450, 0), (450, 450), (0, 450)], close=True)
    table = doc.blocks.new("TABLE-1800x900")
    table.add_lwpolyline([(0, 0), (1800, 0), (1800, 900), (0, 900)], close=True)
    tree = doc.blocks.new("TREE-DECID-6M")
    tree.add_circle((0, 0), 3000)
    tree.add_circle((0, 0), 300)
    wc = doc.blocks.new("WC-PAN")
    wc.add_ellipse((0, 250), major_axis=(0, 250), ratio=0.6)
    basin = doc.blocks.new("BASIN-500")
    basin.add_circle((0, 0), 250)
    tag = doc.blocks.new("ROOM-TAG")
    tag.add_attdef("NAME", (0, 0), dxfattribs={"height": 250})


def build() -> Drawing:
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$PROJECTNAME"] = "SYNTHETIC FIXTURE - NOT A REAL VENUE - DO NOT TRAIN"
    doc.header["$INSUNITS"] = 4  # millimetres, like most architects' files
    for name in EXPECTED:
        if name not in doc.layers:
            doc.layers.add(name)
    _blocks(doc)
    msp = doc.modelspace()
    on = lambda layer: {"layer": layer}  # noqa: E731

    # Walls: a 30 x 20 m outline with partitions (double lines, as drawn).
    for (x1, y1, x2, y2) in [(0, 0, 30000, 0), (30000, 0, 30000, 20000), (30000, 20000, 0, 20000), (0, 20000, 0, 0),
                             (10000, 0, 10000, 20000), (20000, 0, 20000, 12000), (0, 12000, 30000, 12000)]:
        msp.add_line((x1, y1), (x2, y2), dxfattribs=on("A-WALL"))
        dx, dy = (200, 0) if x1 == x2 else (0, 200)
        msp.add_line((x1 + dx, y1 + dy), (x2 + dx, y2 + dy), dxfattribs=on("A-WALL"))
    hatch = msp.add_hatch(color=8, dxfattribs=on("A-WALL-PATT"))
    hatch.paths.add_polyline_path([(0, 0), (30000, 0), (30000, 200), (0, 200)], is_closed=True)

    for x in (4000, 14000, 24000):
        msp.add_blockref("DOOR-SGL-900", (x, 12000), dxfattribs=on("A-DOOR"))
    msp.add_blockref("DOOR-SGL-900", (10000, 6000), dxfattribs={**on("A-DOOR"), "rotation": 90})
    for x in (2000, 6000, 16000, 22000, 26000):
        msp.add_blockref("WIN-1200", (x, 20000), dxfattribs=on("A-GLAZ"))

    for i in range(14):
        msp.add_blockref("STAIR-TREAD", (21000, 13000 + i * 280), dxfattribs=on("A-FLOR-STRS"))
    msp.add_lwpolyline([(21000, 13000), (22200, 13000), (22200, 17000), (21000, 17000)], close=True, dxfattribs=on("A-FLOR-STRS"))
    msp.add_blockref("LIFT-CAR-1100", (23500, 13500), dxfattribs=on("A-FLOR-EVTR"))

    rooms = {"Gallery": (0, 0, 10000, 12000), "Lobby": (10000, 0, 20000, 12000), "Cafe": (20000, 0, 30000, 12000),
             "Office 1": (0, 12000, 10000, 20000), "Store": (10000, 12000, 20000, 20000)}
    for name, (x1, y1, x2, y2) in rooms.items():
        msp.add_lwpolyline([(x1, y1), (x2, y1), (x2, y2), (x1, y2)], close=True, dxfattribs=on("A-AREA"))
        ref = msp.add_blockref("ROOM-TAG", ((x1 + x2) / 2, (y1 + y2) / 2), dxfattribs=on("A-AREA-IDEN"))
        ref.add_auto_attribs({"NAME": name})
        msp.add_text(f"{(x2 - x1) * (y2 - y1) / 1e6:.0f} m2", dxfattribs={**on("A-AREA-IDEN"), "height": 200, "insert": ((x1 + x2) / 2, (y1 + y2) / 2 - 400)})

    # Restrooms: an outline, fixtures and the room's name on a layer called just "WC".
    msp.add_lwpolyline([(25000, 15000), (30000, 15000), (30000, 20000), (25000, 20000)], close=True, dxfattribs=on("WC"))
    for i in range(3):
        msp.add_blockref("WC-PAN", (25500 + i * 1500, 19000), dxfattribs=on("WC"))
        msp.add_blockref("BASIN-500", (25500 + i * 1500, 15600), dxfattribs=on("WC"))
    msp.add_text("WC", dxfattribs={**on("WC"), "height": 300, "insert": (27000, 17500)})

    for i in range(12):
        msp.add_blockref("CHAIR-01", (21000 + (i % 6) * 1200, 2000 + (i // 6) * 3000), dxfattribs=on("I-FURN"))
    for i in range(3):
        msp.add_blockref("TABLE-1800x900", (21500 + i * 2400, 3000), dxfattribs=on("I-FURN"))

    for i in range(8):
        a = i * math.pi / 4
        msp.add_blockref("TREE-DECID-6M", (15000 + 22000 * math.cos(a), 10000 + 16000 * math.sin(a)), dxfattribs=on("L-PLNT"))
    msp.add_lwpolyline([(-6000, -6000), (-1000, -6000), (-1000, -2000), (-6000, -2000)], close=True, dxfattribs=on("L-PLNT"))

    # The path in from the street: open polylines along the walk.
    msp.add_lwpolyline([(15000, -9000), (15000, -1000), (15000, 0)], dxfattribs=on("C-WALK"))
    msp.add_lwpolyline([(13500, -9000), (13500, -1000)], dxfattribs=on("C-WALK"))
    msp.add_lwpolyline([(16500, -9000), (16500, -1000)], dxfattribs=on("C-WALK"))

    for (p1, p2, base) in [((0, 0), (30000, 0), (0, -1500)), ((0, 0), (0, 20000), (-1500, 0)), ((0, 0), (10000, 0), (0, -800))]:
        angle = 90 if p1[0] == p2[0] else 0
        msp.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle, dxfattribs=on("A-ANNO-DIMS")).render()
    msp.add_point((0, 0), dxfattribs=on("Defpoints"))

    # Title block, far from the plan, like a sheet border.
    msp.add_lwpolyline([(40000, -10000), (80000, -10000), (80000, 20000), (40000, 20000)], close=True, dxfattribs=on("A-ANNO-TTLB"))
    for i, t in enumerate(["SYNTHETIC FIXTURE", "GROUND FLOOR PLAN", "SCALE 1:100", "DRAWN: N/A", "REV A"]):
        msp.add_text(t, dxfattribs={**on("A-ANNO-TTLB"), "height": 400, "insert": (41000, -9000 + i * 800)})

    # Ambiguous layers real files have: mixed leftovers on "0", unnamed work layers.
    msp.add_line((5000, 5000), (5500, 5500), dxfattribs=on("0"))
    msp.add_circle((7000, 7000), 300, dxfattribs=on("0"))
    for i in range(4):
        msp.add_line((1000 + i * 500, 1000), (1000 + i * 500, 1600), dxfattribs=on("Layer3"))
    for i in range(3):
        msp.add_circle((3000 + i * 800, 9000), 200, dxfattribs=on("NEW"))
    return doc


def main() -> None:
    build().saveas(HERE / DXF_NAME)
    (HERE / LABELS_NAME).write_text(json.dumps({"synthetic": True, "do_not_train": True, "labels": EXPECTED}, indent=2) + "\n")
    print(f"wrote {HERE / DXF_NAME} and {HERE / LABELS_NAME}")


if __name__ == "__main__":
    main()
