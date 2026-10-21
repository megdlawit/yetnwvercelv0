"""Retrieved examples for the baseline (optional, off by default: YETNEW_RETRIEVAL_K=0).

For each layer, the k most similar layers that people confirmed at OTHER
venues are shown next to it in the prompt, with their labels, as hints.

The bank is example_bank.jsonl, written by export_dataset.py from the
TRAINING venues only (never the held-out ones, never augmented rows), with
text samples following prompt.INCLUDE_TEXT_SAMPLES. So it inherits the export
rules: individual/group confirmations, current consent, legal review.

Similarity is deterministic and cheap: cosine over sets of features — layer
name tokens and character trigrams, entity types, block-name tokens. Ties are
broken by venue id and name, so the same layer always gets the same examples.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_WORD = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True)
class BankEntry:
    building_id: str
    label: str
    summary: dict[str, Any]


def features(summary: dict[str, Any]) -> frozenset[str]:
    name = str(summary.get("name", "")).lower()
    words = _WORD.findall(name)
    padded = f"^{name}$"
    out = {f"w:{w}" for w in words}
    out |= {f"c:{padded[i:i + 3]}" for i in range(len(padded) - 2)}
    counts = {str(t).upper(): n for t, n in dict(summary.get("entity_counts") or {}).items()}
    out |= {f"e:{t}" for t in counts}
    if counts:
        # The dominant entity type says a lot (LINEs → walls, INSERTs → doors/furniture): weight it ×3,
        # so a shared discipline prefix like "A-" doesn't outweigh it.
        top = max(counts, key=lambda t: (counts[t], t))
        out |= {f"d{i}:{top}" for i in range(3)}
    out |= {f"b:{w}" for b in summary.get("blocks") or [] for w in _WORD.findall(str(b).lower())}
    return frozenset(out)


def similarity(a: frozenset[str], b: frozenset[str]) -> float:
    return len(a & b) / math.sqrt(len(a) * len(b)) if a and b else 0.0


class ExampleBank:
    def __init__(self, entries: list[BankEntry]) -> None:
        self.entries = entries
        self._features = [features(e.summary) for e in entries]

    @classmethod
    def load(cls, path: Path) -> ExampleBank:
        entries = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                entries.append(BankEntry(str(row["building_id"]), str(row["label"]), dict(row["summary"])))
        return cls(entries)

    def __len__(self) -> int:
        return len(self.entries)

    def nearest(self, summary: dict[str, Any], k: int, *, exclude_building: str | None = None) -> list[BankEntry]:
        """The k most similar confirmed layers (similarity > 0), never from `exclude_building`."""
        if k <= 0:
            return []
        q = features(summary)
        scored = [
            (similarity(q, f), e)
            for e, f in zip(self.entries, self._features)
            if e.building_id != exclude_building
        ]
        scored = [(s, e) for s, e in scored if s > 0]
        scored.sort(key=lambda se: (-se[0], se[1].building_id, str(se[1].summary.get("name", ""))))
        return [e for _, e in scored[:k]]
