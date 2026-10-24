from pathlib import Path

import ezdxf
import pytest

from yetnew_layers.summarize import DxfReadError, summarize_doc, summarize_file


def _drawing() -> ezdxf.document.Drawing:
    doc = ezdxf.new()
    msp = doc.modelspace()
    doc.layers.add("A-WALL")
    doc.layers.add("EMPTY-LAYER")
    for i in range(6):
        msp.add_line((i, 0), (i, 5), dxfattribs={"layer": "A-WALL"})
    msp.add_lwpolyline([(0, 0), (1, 0), (1, 1)], close=True, dxfattribs={"layer": "A-WALL"})
    # A layer that's only used by entities, never defined in the layer table.
    for name in ["DOOR-900", "DOOR-900", "DOOR-1200", "D3", "D4", "D5", "D6"]:
        if name not in doc.blocks:
            doc.blocks.new(name).add_line((0, 0), (1, 1))
        msp.add_blockref(name, (0, 0), dxfattribs={"layer": "A-DOOR"})
    for text in ["Room 101", "Room 101", "Lobby", "A very long room name that goes on and on", "Café", "WC", "Store"]:
        msp.add_text(text, dxfattribs={"layer": "A-ANNO"})
    msp.add_mtext("Main\\Phall", dxfattribs={"layer": "A-ANNO"})
    msp.add_circle((0, 0), 1, dxfattribs={"layer": "A-WALL"})
    msp.add_arc((0, 0), 1, 0, 90, dxfattribs={"layer": "A-WALL"})
    msp.add_point((0, 0), dxfattribs={"layer": "A-WALL"})
    return doc


def by_name(summaries: list[dict]) -> dict[str, dict]:
    return {s["name"]: s for s in summaries}


def test_counts_top_four_entity_types_most_common_first() -> None:
    wall = by_name(summarize_doc(_drawing()))["A-WALL"]
    assert wall["total"] == 10
    assert list(wall["entity_counts"]) == ["LINE", "ARC", "CIRCLE", "LWPOLYLINE"]  # ties sorted by name; POINT dropped
    assert wall["entity_counts"]["LINE"] == 6


def test_blocks_limited_to_five_most_used_first() -> None:
    door = by_name(summarize_doc(_drawing()))["A-DOOR"]
    assert len(door["blocks"]) == 5
    assert door["blocks"][0] == "DOOR-900"


def test_texts_limited_cleaned_and_truncated() -> None:
    anno = by_name(summarize_doc(_drawing()))["A-ANNO"]
    assert len(anno["texts"]) == 5
    assert anno["texts"][0] == "Room 101"
    assert all(len(t) <= 30 for t in anno["texts"])
    assert "A very long room name that goe" in anno["texts"]  # cut to exactly 30 characters


def test_mtext_formatting_is_removed() -> None:
    doc = ezdxf.new()
    doc.modelspace().add_mtext("Main\\Phall", dxfattribs={"layer": "T"})
    assert by_name(summarize_doc(doc))["T"]["texts"] == ["Main hall"]


def test_includes_empty_table_layers_and_undefined_entity_layers() -> None:
    names = by_name(summarize_doc(_drawing()))
    assert names["EMPTY-LAYER"]["total"] == 0
    assert names["EMPTY-LAYER"]["entity_counts"] == {}
    assert "A-DOOR" in names  # used, not in the layer table


def test_busiest_layers_first() -> None:
    totals = [s["total"] for s in summarize_doc(_drawing())]
    assert totals == sorted(totals, reverse=True)


def test_summary_is_deterministic(tmp_path: Path) -> None:
    path = tmp_path / "plan.dxf"
    _drawing().saveas(path)
    assert summarize_file(path) == summarize_file(path)


def test_unreadable_file_raises(tmp_path: Path) -> None:
    path = tmp_path / "not.dxf"
    path.write_text("this is not a drawing")
    with pytest.raises(DxfReadError):
        summarize_file(path)


def test_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(DxfReadError):
        summarize_file(tmp_path / "missing.dxf")


def test_fast_reader_matches_ezdxf(tmp_path: Path) -> None:
    """Big drawings are read by streaming (fast_summarize_file): the summary must be exactly
    what ezdxf gives, or the model sees different facts than it was trained on."""
    from yetnew_layers.summarize import fast_summarize_file

    doc = ezdxf.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("A-WALL")
    msp.add_line((0, 0), (5, 0), dxfattribs={"layer": "A-WALL"})
    msp.add_polyline2d([(0, 0), (1, 0), (1, 1)], dxfattribs={"layer": "OLD-PLINE"})   # VERTEX … SEQEND
    msp.add_lwpolyline([(0, 0), (2, 0), (2, 2)], dxfattribs={"layer": "A-WALL"})
    tag = doc.blocks.new("ROOM-TAG")
    tag.add_attdef("NAME", (0, 0))
    msp.add_blockref("ROOM-TAG", (3, 3), dxfattribs={"layer": "TAGS"}).add_auto_attribs({"NAME": "Meeting Room 2"})
    msp.add_blockref("ROOM-TAG", (4, 4), dxfattribs={"layer": "TAGS"})              # no attributes
    msp.add_text("Lobby", dxfattribs={"layer": "A-TEXT"})
    msp.add_mtext("Main \Pentrance " + "x" * 300, dxfattribs={"layer": "A-TEXT"})    # long: split into chunks
    doc.layouts.get("Layout1").add_line((0, 0), (1, 1), dxfattribs={"layer": "SHEET"})  # paper space: left out
    path = tmp_path / "mixed.dxf"
    doc.saveas(path)

    assert fast_summarize_file(path) == summarize_doc(ezdxf.readfile(path))
