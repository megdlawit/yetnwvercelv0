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


def summarize_file(path: str | Path) -> list[dict[str, Any]]:
    return summarize_doc(read_dxf(path))
