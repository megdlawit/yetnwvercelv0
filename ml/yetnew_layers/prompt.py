"""Every prompt the labeler sends — and what each label means — in ONE place.

Training (dataset export, the Colab notebook) and inference (the service)
import these functions, so the fine-tuned model sees at inference exactly the
text it was trained on, including the label guide below. Change anything here
and the fine-tuned model must be retrained: bump PROMPT_VERSION so old
datasets are recognisable.

Two prompts:
  * batch_messages: the zero-shot baseline. Many layers per request, JSON out
    (name + label). Confidence comes from the label tokens' log-probs, not
    from a number the model writes.
  * layer_messages: the fine-tuned model. One layer per request; the answer is
    exactly one label, nothing else.

The examples deliberately do not reuse the layer names of the synthetic test
fixture (tests/fixtures), so the fixture still measures generalisation.
"""

from __future__ import annotations

import json
import math
import os
from collections.abc import Sequence
from typing import Any, Final

from .labels import LABELS

PROMPT_VERSION: Final[int] = 3

#: THE switch for text samples (room names etc. written in the drawing).
#: Off by default: then no prompt — baseline, fine-tuned, training row — ever
#: contains them, and the training export asks the database to leave them out
#: too. Turn on only deliberately (YETNEW_INCLUDE_TEXT_SAMPLES=1), and then for
#: export, training, evaluation and the service alike: a fine-tuned model must
#: run with the setting it was trained with (recorded in the dataset manifest
#: and model_choice.json, and checked before the fine-tuned model is used).
INCLUDE_TEXT_SAMPLES: Final[bool] = os.environ.get("YETNEW_INCLUDE_TEXT_SAMPLES", "0").strip().lower() in {"1", "true", "yes"}

#: label → (one-line definition, short examples). Shown to every model, and to admins in the docs.
LABEL_GUIDE: Final[dict[str, tuple[str, str]]] = {
    "wall": (
        "walls, partitions and columns — structure people cannot walk through",
        "S-COLS with many LWPOLYLINE; MUROS or Wände with long LINEs",
    ),
    "door": (
        "doors and doorways",
        "DOORS with INSERT blocks like DR-SINGLE-900 and swing ARCs; PUERTAS",
    ),
    "window": (
        "windows, glazing and curtain walls",
        "A-WIND with window blocks; FENSTER with short parallel LINEs in walls",
    ),
    "stairs": (
        "stairs, steps, ramps with steps, escalators",
        "S-STAIR with many parallel tread LINEs and texts UP/DN; ESCALERA",
    ),
    "elevator": (
        "elevators and lifts",
        "A-ELEV with LIFT-CAR blocks; ASCENSOR",
    ),
    "restroom": (
        "restrooms, toilets and washrooms — the rooms or their sanitary fixtures",
        "TOILETS with urinal/basin blocks; A-PLUM-FIXT with text 'Ladies'",
    ),
    "room": (
        "outlines of rooms, halls and zones (closed shapes)",
        "A-ROOM-BNDY or SPACES with closed LWPOLYLINEs and no text",
    ),
    "walkable": (
        "paths, corridors, walkways, trails and plazas meant for walking",
        "PATHS or L-SITE-WALK with polylines/HATCH along routes",
    ),
    "vegetation": (
        "trees, plants, shrubs, lawns and planting beds",
        "L-TREE with TREE-* blocks; PLANTING with CIRCLEs",
    ),
    "furniture": (
        "furniture, fixtures and equipment",
        "A-FURN-SEAT with chair/table blocks; MOBILIAR; Q-CASE counters",
    ),
    "text": (
        "room names, labels and annotations that name things in the building",
        "A-ROOM-NAME with TEXT 'Lobby', 'Café'; ROOM-TAGS with attribute blocks",
    ),
    "dimension": (
        "dimension lines and measurements",
        "A-DIMS or COTAS with DIMENSION entities",
    ),
    "ignore": (
        "drawing furniture not part of the place: borders, title blocks, grids, viewports, hatch patterns, general notes",
        "A-GRID with grid bubbles; VPORTS; BORDER with the title block; *-HATCH layers with only HATCH",
    ),
    "unknown": (
        "the information given does not decide any label above",
        "a generic name such as 'Layer 7' or 'Temp' holding a few plain LINEs and nothing that points to a label",
    ),
}

assert tuple(LABEL_GUIDE) == LABELS, "LABEL_GUIDE must cover every label, in LABELS order"


def label_guide() -> str:
    """The label list as the models see it: '- label: definition (e.g. examples)'."""
    return "\n".join(f"- {label}: {definition}. e.g. {examples}" for label, (definition, examples) in LABEL_GUIDE.items())


#: Hard caps on what one layer adds to a prompt, whatever the summary holds
#: (summaries from the database pass through here too). With them, a layer
#: costs at most ~250 tokens, so batches can be planned to fit num_ctx.
MAX_NAME_CHARS: Final[int] = 100
MAX_ENTITY_TYPES: Final[int] = 4
MAX_BLOCKS: Final[int] = 5
MAX_BLOCK_CHARS: Final[int] = 40
MAX_TEXTS: Final[int] = 5
MAX_TEXT_CHARS: Final[int] = 30


def _cut(value: Any, limit: int) -> str:
    return " ".join(str(value).split())[:limit]


def layer_payload(summary: dict[str, Any]) -> dict[str, Any]:
    """The facts about one layer the model sees, in a fixed shape and order, cut to the caps."""
    counts = list(dict(summary.get("entity_counts") or {}).items())[:MAX_ENTITY_TYPES]
    return {
        "layer": _cut(summary.get("name", ""), MAX_NAME_CHARS),
        "entities": {_cut(k, 24): int(v) for k, v in counts},
        "blocks": [_cut(b, MAX_BLOCK_CHARS) for b in list(summary.get("blocks") or [])[:MAX_BLOCKS]],
        "texts": [_cut(t, MAX_TEXT_CHARS) for t in list(summary.get("texts") or [])[:MAX_TEXTS]] if INCLUDE_TEXT_SAMPLES else [],
    }


def payload_json(summary: dict[str, Any]) -> str:
    """Compact, key-sorted JSON: identical input always gives an identical prompt."""
    return json.dumps(layer_payload(summary), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


_INTRO = """You label the layers of architectural CAD drawings (DXF) for an indoor and outdoor navigation map.
For each layer you get its name, the most common entity types with counts, block names, and text samples.
Layer names often follow AIA/NCS conventions (A- architectural, S- structural, L- landscape, I- interiors, C- civil) or are in other languages.
Decide from the content (entities, blocks, texts) as well as the name."""


# ── Baseline (zero-shot, batched) ────────────────────────────────────────────

BATCH_SYSTEM = f"""{_INTRO}

Choose exactly one label per layer from this list:
{label_guide()}

Rules:
- Use only the labels above, spelled exactly as written.
- If the information does not decide the label, answer "unknown". Do not guess "ignore".
- Return every layer you were given, using its name exactly as given.
- Answer with JSON only."""

#: The JSON shape the baseline must return (Ollama structured outputs).
#: Only name and label: confidence is read from the label tokens' log-probs.
BATCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "layers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "label": {"type": "string", "enum": list(LABELS)},
                },
                "required": ["name", "label"],
            },
        }
    },
    "required": ["layers"],
}


# ── Baseline with retrieved examples (optional: YETNEW_RETRIEVAL_K) ─────────
# Each layer may carry "similar": confirmed layers from other venues and the
# label people gave them (retrieval.ExampleBank). Same label guide, one rule more.

BATCH_SYSTEM_RETRIEVAL = BATCH_SYSTEM.replace(
    "\n- Answer with JSON only.",
    "\n- Some layers include \"similar\": layers from other venues that people confirmed, with their label."
    " Use them as hints; decide from this layer's own content.\n- Answer with JSON only.",
)

#: One retrieved example: (summary, confirmed label).
Example = tuple[dict[str, Any], str]


def example_payload(summary: dict[str, Any], label: str) -> dict[str, Any]:
    """A confirmed layer shown as a hint: the same facts the model sees for any layer, plus its label."""
    return {**layer_payload(summary), "label": label}


def layer_json(summary: dict[str, Any], examples: Sequence[Example] | None = None) -> str:
    """One layer's line in a batch prompt — with its retrieved examples, if any."""
    if not examples:
        return payload_json(summary)
    payload = {**layer_payload(summary), "similar": [example_payload(s, label) for s, label in examples]}
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def batch_messages(summaries: list[dict[str, Any]], examples: Sequence[Sequence[Example]] | None = None) -> list[dict[str, str]]:
    """The baseline prompt. `examples` (one list per layer) switches to the retrieval prompt."""
    lines = [layer_json(s, examples[i] if examples is not None else None) for i, s in enumerate(summaries)]
    layers = ",\n".join(lines)
    return [
        {"role": "system", "content": BATCH_SYSTEM_RETRIEVAL if examples is not None else BATCH_SYSTEM},
        {"role": "user", "content": f'Label these {len(summaries)} layers. Reply as {{"layers":[{{"name":…,"label":…}}]}}.\n[\n{layers}\n]'},
    ]


# ── Token budget ─────────────────────────────────────────────────────────────
# A deliberately pessimistic estimate (Qwen averages ~3.3 characters per token
# on these prompts; JSON with digits and CAD names can be denser), so planned
# batches fit num_ctx with room to spare.

CHARS_PER_TOKEN: Final[float] = 2.5
#: Chat template and role markers.
TEMPLATE_TOKENS: Final[int] = 64
#: Headroom for the answer's JSON wrapper ({"layers": [ … ]}) on top of the per-layer answers.
ANSWER_OVERHEAD_TOKENS: Final[int] = 64


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / CHARS_PER_TOKEN)


def batch_overhead_tokens(retrieval: bool = False) -> int:
    """Tokens every batch request costs before any layer is added (prompt and answer):
    system prompt, chat template, the request line (with a 4-digit layer count) and answer headroom."""
    wrapper = batch_messages([])[1]["content"]  # the request line and the [ ] around the layers
    system = BATCH_SYSTEM_RETRIEVAL if retrieval else BATCH_SYSTEM
    return estimate_tokens(system) + TEMPLATE_TOKENS + estimate_tokens(wrapper) + 2 + ANSWER_OVERHEAD_TOKENS


def layer_prompt_tokens(summary: dict[str, Any], examples: Sequence[Example] | None = None) -> int:
    """What one layer (with its retrieved examples) adds to a batch prompt."""
    return estimate_tokens(layer_json(summary, examples)) + 1


def layer_answer_tokens(summary: dict[str, Any]) -> int:
    """What the model writes back for one layer: {"name": …, "label": …}."""
    name = json.dumps(layer_payload(summary)["layer"], ensure_ascii=False)
    return estimate_tokens(f'    {{"name": {name}, "label": "vegetation"}},\n') + 2


# ── Fine-tuned (one layer, one label) ────────────────────────────────────────

LAYER_SYSTEM = f"""{_INTRO}

You get one layer. Answer with exactly one label from this list and nothing else:
{label_guide()}"""


def layer_messages(summary: dict[str, Any]) -> list[dict[str, str]]:
    """The prompt for one layer — the training example minus the assistant's answer."""
    return [
        {"role": "system", "content": LAYER_SYSTEM},
        {"role": "user", "content": payload_json(summary)},
    ]


def training_example(summary: dict[str, Any], label: str) -> dict[str, list[dict[str, str]]]:
    """One chat-format training row: the inference prompt plus the right answer."""
    return {"messages": [*layer_messages(summary), {"role": "assistant", "content": label}]}
