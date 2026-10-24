"""Reads a DXF and describes each layer in a few small facts the model can use.

Per layer: the four most common entity types with counts, up to five block
names, and up to five text samples (each cut to 30 characters). Only model
space is read — paper space holds sheet layouts, not the building.

The summary is also what the training data stores, so it must stay stable:
bump SUMMARIZER_VERSION whenever its content or ordering changes.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import recover
from ezdxf.document import Drawing

SUMMARIZER_VERSION = 1

MAX_ENTITY_TYPES = 4
MAX_BLOCKS = 5
MAX_TEXTS = 5
MAX_TEXT_CHARS = 30

_SPACES = re.compile(r"\s+")


class DxfReadError(Exception):
    """The file could not be read as a DXF drawing."""


@dataclass
class LayerSummary:
    name: str
    total: int = 0
    entity_counts: dict[str, int] = field(default_factory=dict)
    blocks: list[str] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "total": self.total,
            "entity_counts": dict(self.entity_counts),
            "blocks": list(self.blocks),
            "texts": list(self.texts),
        }


def clean_text(raw: str) -> str:
    """One line, collapsed spaces, at most MAX_TEXT_CHARS characters."""
    return _SPACES.sub(" ", raw).strip()[:MAX_TEXT_CHARS]


def _top(counter: Counter[str], n: int) -> list[tuple[str, int]]:
    """Most common first; ties broken by name so the summary is deterministic."""
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


def _entity_text(entity: Any) -> list[str]:
    kind = entity.dxftype()
    if kind == "TEXT":
        return [entity.dxf.get("text", "")]
    if kind == "MTEXT":
        return [entity.plain_text()]
    if kind == "INSERT":
        # Attribute values on a block (a room tag's name and number).
        return [a.dxf.get("text", "") for a in getattr(entity, "attribs", [])]
    return []


def summarize_doc(doc: Drawing) -> list[dict[str, Any]]:
    """Every layer in the drawing — defined in the layer table or only used by entities."""
    types: dict[str, Counter[str]] = {}
    blocks: dict[str, Counter[str]] = {}
    texts: dict[str, Counter[str]] = {}

    def layer(name: str) -> str:
        types.setdefault(name, Counter())
        blocks.setdefault(name, Counter())
        texts.setdefault(name, Counter())
        return name

    for table_layer in doc.layers:
        layer(table_layer.dxf.name)

    for entity in doc.modelspace():
        name = layer(entity.dxf.get("layer", "0"))
        types[name][entity.dxftype()] += 1
        if entity.dxftype() == "INSERT":
            blocks[name][entity.dxf.get("name", "")] += 1
        for raw in _entity_text(entity):
            text = clean_text(raw)
            if text:
                texts[name][text] += 1

    summaries: list[LayerSummary] = []
    for name, counter in types.items():
        summaries.append(
            LayerSummary(
                name=name,
                total=sum(counter.values()),
                entity_counts=dict(_top(counter, MAX_ENTITY_TYPES)),
                blocks=[b for b, _ in _top(blocks[name], MAX_BLOCKS) if b],
                texts=[t for t, _ in _top(texts[name], MAX_TEXTS)],
            )
        )
    # Busiest layers first, then by name: the order the editor shows them.
    summaries.sort(key=lambda s: (-s.total, s.name))
    return [s.to_dict() for s in summaries]


def read_dxf(path: str | Path) -> Drawing:
    """Opens a DXF, repairing what it can (converted DWG files are often a little broken)."""
    try:
        doc, auditor = recover.readfile(str(path))
    except (OSError, ezdxf.DXFStructureError) as err:
        raise DxfReadError(f"Not a readable DXF file: {err}") from err
    if auditor.has_errors:
        # Unrecoverable structure errors: the layer facts can't be trusted.
        raise DxfReadError(f"The DXF has {len(auditor.errors)} unrecoverable errors.")
    return doc


# Above this size the drawing is read by streaming its group codes (fast_summarize_file):
# loading it whole into ezdxf takes many minutes and gigabytes for a 100+ MB converted DWG.
FAST_READ_BYTES = 40 * 1024 * 1024


def summarize_file(path: str | Path) -> list[dict[str, Any]]:
    if Path(path).is_file() and Path(path).stat().st_size > FAST_READ_BYTES:
        return fast_summarize_file(path)
    return summarize_doc(read_dxf(path))


def _pairs(path: str | Path):
    """(code, value) group-code pairs of a DXF, streamed line by line."""
    with open(path, encoding="utf-8", errors="replace", newline=None) as fh:
        while True:
            code = fh.readline()
            if not code:
                return
            value = fh.readline()
            try:
                yield int(code), value.rstrip("\r\n")
            except ValueError:
                continue


def fast_summarize_file(path: str | Path) -> list[dict[str, Any]]:
    """The same summary as summarize_doc, without loading the drawing: reads the LAYER table
    and the model-space entities of the ENTITIES section (code 67 = 1 is paper space), with
    INSERT attributes and MTEXT continuation chunks, as ezdxf would see them."""
    from ezdxf.tools.text import fast_plain_mtext

    types: dict[str, Counter[str]] = {}
    blocks: dict[str, Counter[str]] = {}
    texts: dict[str, Counter[str]] = {}

    def layer(name: str) -> str:
        types.setdefault(name, Counter())
        blocks.setdefault(name, Counter())
        texts.setdefault(name, Counter())
        return name

    section = table = None
    current: dict[str, Any] | None = None   # the entity being read
    parent: dict[str, Any] | None = None    # an INSERT whose ATTRIBs follow

    def finish(e: dict[str, Any] | None) -> None:
        if e is None or e.get("paper"):
            return
        name = layer(e.get("layer", "0"))
        kind = e["type"]
        types[name][kind] += 1
        if kind == "INSERT":
            blocks[name][e.get("block", "")] += 1
            raws = e.get("attribs", [])
        elif kind == "TEXT":
            raws = [e.get("text1", "")]
        elif kind == "MTEXT":
            raws = [fast_plain_mtext("".join(e.get("chunks", [])) + e.get("text1", ""))]
        else:
            raws = []
        for raw in raws:
            text = clean_text(raw)
            if text:
                texts[name][text] += 1

    def close() -> None:
        """The entity being read is complete (an INSERT with attributes completes at SEQEND)."""
        nonlocal current, parent
        if parent is not None:
            finish(parent)
        elif current is not None and current["type"] not in ("ATTRIB", "SEQEND", "VERTEX"):
            finish(current)
        current = parent = None

    for code, value in _pairs(path):
        if code == 0:
            kind = value.strip()
            if kind == "SECTION":
                section = None
                continue
            if kind == "ENDSEC":
                if section == "ENTITIES":
                    close()
                section = table = None
                continue
            if section == "TABLES":
                if kind == "TABLE":
                    table = "?"
                elif kind == "ENDTAB":
                    table = None
                elif table == "LAYER" and kind == "LAYER":
                    current = {"type": "LAYER"}
                continue
            if section == "ENTITIES":
                if kind == "ATTRIB" and parent is not None:
                    parent.setdefault("attribs", []).append("")
                    current = {"type": "ATTRIB"}
                    continue
                if kind in ("SEQEND", "VERTEX"):
                    if kind == "SEQEND":
                        close()
                    current = {"type": kind}
                    continue
                close()
                current = {"type": kind}
                if kind == "POLYLINE":
                    parent = current            # its VERTEXes follow, until SEQEND
                continue
            continue
        if code == 2 and section is None:
            section = value.strip()
            continue
        if section == "TABLES":
            if code == 2 and table == "?":
                table = value.strip()
            elif code == 2 and table == "LAYER" and current is not None and current["type"] == "LAYER":
                layer(value.strip())
                current = None
            continue
        if section != "ENTITIES" or current is None:
            continue
        t = current["type"]
        if t == "ATTRIB":
            if code == 1 and parent is not None:
                parent["attribs"][-1] = value
            continue
        if t in ("SEQEND", "VERTEX"):
            continue
        if code == 8:
            current["layer"] = value.strip()
        elif code == 67:
            current["paper"] = value.strip() == "1"
        elif code == 2 and t == "INSERT":
            current["block"] = value.strip()
        elif code == 66 and t == "INSERT" and value.strip() == "1":
            parent = current
        elif code == 1 and t in ("TEXT", "MTEXT"):
            current["text1"] = value
        elif code == 3 and t == "MTEXT":
            current.setdefault("chunks", []).append(value)
    close()
    # ezdxf adds the standard layers a file leaves out of its table.
    for std in ("0", "Defpoints"):
        if not any(n.lower() == std.lower() for n in types):
            layer(std)

    summaries: list[LayerSummary] = []
    for name, counter in types.items():
        summaries.append(
            LayerSummary(
                name=name,
                total=sum(counter.values()),
                entity_counts=dict(_top(counter, MAX_ENTITY_TYPES)),
                blocks=[b for b, _ in _top(blocks[name], MAX_BLOCKS) if b],
                texts=[t for t, _ in _top(texts[name], MAX_TEXTS)],
            )
        )
    summaries.sort(key=lambda s: (-s.total, s.name))
    return [s.to_dict() for s in summaries]
