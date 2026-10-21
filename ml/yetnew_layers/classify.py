"""Labels a drawing's layers with a local model.

Confidence is never a number the model writes about itself (small models say
0.99 when wrong). It is the model's own probability of the label it chose,
read from Ollama's token log-probs:

  * Baseline: layers go in batches and the model answers JSON. A layer's
    confidence is exp(sum of log-probs) of the tokens that spell its label
    value — not the quotes or punctuation around it, whose probability is
    about formatting. Log-probs are of the model's unconstrained choice, so
    probability it puts on off-list spellings ("walls") counts against it.
  * Fine-tuned: one layer per request, the answer is one label; confidence is
    the probability of the whole answer. Without log-probs a layer is flagged
    whenever the fine-tuned and baseline labels disagree.

Confidence flags layers (needs_review) and orders the review list. Whether a
layer must be confirmed before "Create venue" is labels.must_confirm.

Everything a model returns is checked: labels outside the fixed list, skipped
layers and non-JSON answers all become "unknown", which always goes to review.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Sequence
from dataclasses import asdict, dataclass, replace
from typing import Any, Callable

from .config import Settings
from .labels import clamp_confidence, must_confirm, needs_review, validate_label
from .ollama import chat
from .prompt import (
    ANSWER_OVERHEAD_TOKENS,
    BATCH_SCHEMA,
    Example,
    batch_messages,
    batch_overhead_tokens,
    layer_answer_tokens,
    layer_messages,
    layer_payload,
    layer_prompt_tokens,
)
from .retrieval import ExampleBank


def retrieved_examples(summaries: list[dict[str, Any]], bank: ExampleBank, k: int,
                       exclude_building: str | None = None) -> list[list[Example]]:
    """Each layer's k nearest confirmed layers — the one function the service and evaluate.py both use."""
    return [[(e.summary, e.label) for e in bank.nearest(s, k, exclude_building=exclude_building)] for s in summaries]


@dataclass
class LayerResult:
    name: str
    label: str
    #: P(label) from log-probs; None when Ollama gave none.
    confidence: float | None
    #: Flagged for the admin: low or missing confidence, or a label in ALWAYS_CONFIRM.
    needs_review: bool
    #: "Create venue" stays disabled until the admin confirms this layer.
    must_confirm: bool = True
    #: Who decided: "model", "rules" (the editor's name rules were sure; the model wasn't asked)
    #: or "empty" (nothing on the layer). Saved with the label, so rules are never taken for the model.
    source: str = "model"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def result(name: str, label: Any, confidence: float | None) -> LayerResult:
    """A checked result. An invalid or missing label becomes "unknown" with confidence 0;
    a label the model chose keeps its probability."""
    checked = validate_label(label)
    chosen = isinstance(label, str) and label.strip().lower() == checked
    conf = (round(clamp_confidence(confidence), 3) if confidence is not None else None) if chosen else 0.0
    flagged = needs_review(checked, conf)
    return LayerResult(name=name, label=checked, confidence=conf, needs_review=flagged, must_confirm=must_confirm(flagged))


def skip_empty(summaries: list[dict[str, Any]],
               classify: Callable[[list[dict[str, Any]]], list[LayerResult]],
               known: dict[str, str] | None = None) -> list[LayerResult]:
    """Asks the model only about layers that need it. An empty layer adds nothing to the map,
    so it is "ignore"; a layer in `known` (the editor's name rules were sure: "A-DOOR",
    "DIMANTION"…) keeps that label. Real drawings are mostly empty layers (286 layers, 60
    used, in one) and rules settle most of the rest, while a CPU spends minutes per batch."""
    known = {k: v for k, v in (known or {}).items() if validate_label(v) == v and v != "unknown"}
    out: list[LayerResult] = []
    ask: list[int] = []
    for i, s in enumerate(summaries):
        name = str(s.get("name", ""))
        if int(s.get("total", 0) or 0) == 0:
            out.append(replace(result(name, "ignore", 1.0), source="empty"))
        elif name in known:
            out.append(replace(result(name, known[name], None), source="rules"))
        else:
            out.append(result(name, "unknown", None))
            ask.append(i)
    for i, r in zip(ask, classify([summaries[i] for i in ask]) if ask else []):
        out[i] = r
    return out


_LABEL_VALUE = re.compile(r'"label"\s*:\s*"([^"]*)"')


def label_probabilities(resp: dict[str, Any]) -> list[float] | None:
    """P(label value) for each "label" in the answer, in order; None without usable log-probs.

    The tokens are laid end to end to recover each token's character span; a
    label's probability is the product over the tokens overlapping its value.
    """
    tokens = resp.get("logprobs")
    if not isinstance(tokens, list) or not tokens:
        return None
    spans: list[tuple[int, int, float]] = []
    text_parts: list[str] = []
    pos = 0
    for t in tokens:
        tok = t.get("token") if isinstance(t, dict) else None
        lp = t.get("logprob") if isinstance(t, dict) else None
        if not isinstance(tok, str) or not isinstance(lp, (int, float)):
            return None
        spans.append((pos, pos + len(tok), float(lp)))
        text_parts.append(tok)
        pos += len(tok)
    text = "".join(text_parts)
    out: list[float] = []
    for match in _LABEL_VALUE.finditer(text):
        start, end = match.span(1)
        total = sum(lp for a, b, lp in spans if a < end and b > start)
        out.append(math.exp(total))
    return out


def parse_batch_answer(content: str, names: list[str], probabilities: list[float] | None = None) -> list[LayerResult]:
    """Matches the model's JSON answer back to the layers that were asked about.

    `probabilities` (from label_probabilities) line up with the answer's items
    in order; if their count doesn't match the items, they are not used.
    """
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        data = {}
    items = data.get("layers") if isinstance(data, dict) else None
    items = items if isinstance(items, list) else []
    probs = probabilities if probabilities is not None and len(probabilities) == len(items) else None
    by_name: dict[str, tuple[dict[str, Any], float | None]] = {}
    by_lower: dict[str, tuple[dict[str, Any], float | None]] = {}
    for i, item in enumerate(items):
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            entry = (item, probs[i] if probs else None)
            by_name.setdefault(item["name"], entry)
            by_lower.setdefault(item["name"].strip().lower(), entry)
    out: list[LayerResult] = []
    for name in names:
        # Exact name first; CAD layer names are case-insensitive, so fall back to that.
        found = by_name.get(name) or by_lower.get(name.strip().lower())
        out.append(result(name, found[0].get("label"), found[1]) if found else result(name, None, None))
    return out


ChatFn = Callable[..., dict[str, Any]]
#: Called after each step with (layers done, layers total). May raise to stop the run.
ProgressFn = Callable[[int, int], None]


def plan_batches(summaries: list[dict[str, Any]], settings: Settings,
                 examples: Sequence[Sequence[Example]] | None = None) -> list[list[int]]:
    """Splits layers (by index) into batches that fit settings.num_ctx: the
    system prompt, every layer's payload (with its retrieved examples) and
    every layer's answer, estimated pessimistically. Also at most
    settings.batch_size layers per batch."""
    budget = settings.num_ctx - batch_overhead_tokens(retrieval=examples is not None)
    if budget <= 0:
        raise ValueError(f"YETNEW_NUM_CTX={settings.num_ctx} is smaller than the labeling prompt itself; use 4096 or more.")
    batches: list[list[int]] = []
    current: list[int] = []
    used = 0
    for i, s in enumerate(summaries):
        cost = layer_prompt_tokens(s, examples[i] if examples is not None else None) + layer_answer_tokens(s)
        if current and (len(current) >= settings.batch_size or used + cost > budget):
            batches.append(current)
            current, used = [], 0
        current.append(i)
        used += cost
    if current:
        batches.append(current)
    return batches


def _label_batch(batch: list[dict[str, Any]], settings: Settings, model: str, chat_fn: ChatFn,
                 examples: Sequence[Sequence[Example]] | None = None) -> list[LayerResult]:
    # The model sees names cut to the prompt caps; match on those, report the originals.
    shown = [str(layer_payload(s)["layer"]) for s in batch]
    resp = chat_fn(
        settings.ollama_url,
        model,
        batch_messages(batch, examples),
        format=BATCH_SCHEMA,
        logprobs=True,
        num_ctx=settings.num_ctx,
        num_predict=sum(layer_answer_tokens(s) for s in batch) + ANSWER_OVERHEAD_TOKENS,
        timeout=settings.timeout,
    )
    if resp.get("done_reason") == "length" and len(batch) > 1:
        # The answer was cut off (estimate too optimistic for this batch): halve and retry.
        half = len(batch) // 2
        ex_a, ex_b = (examples[:half], examples[half:]) if examples is not None else (None, None)
        return (_label_batch(batch[:half], settings, model, chat_fn, ex_a)
                + _label_batch(batch[half:], settings, model, chat_fn, ex_b))
    content = (resp.get("message") or {}).get("content", "")
    results = parse_batch_answer(content, shown, label_probabilities(resp))
    for r, s in zip(results, batch):
        r.name = str(s.get("name", ""))
    return results


def classify_baseline(
    summaries: list[dict[str, Any]],
    settings: Settings,
    *,
    model: str | None = None,
    chat_fn: ChatFn = chat,
    on_progress: ProgressFn | None = None,
    bank: ExampleBank | None = None,
    retrieval_k: int = 0,
    examples: Sequence[Sequence[Example]] | None = None,
) -> list[LayerResult]:
    """Labels every layer with the zero-shot model, in batches planned to fit the context window.
    With a bank and retrieval_k > 0, each layer carries its k nearest confirmed layers as hints;
    or pass `examples` (one list per layer) chosen and checked by the caller (evaluate.py)."""
    model = model or settings.base_model
    if examples is None and bank is not None and retrieval_k > 0:
        examples = retrieved_examples(summaries, bank, retrieval_k)
    results: list[LayerResult | None] = [None] * len(summaries)
    done = 0
    for idx in plan_batches(summaries, settings, examples):
        batch_examples = [examples[i] for i in idx] if examples is not None else None
        for i, r in zip(idx, _label_batch([summaries[i] for i in idx], settings, model, chat_fn, batch_examples)):
            results[i] = r
        done += len(idx)
        if on_progress:
            on_progress(done, len(summaries))
    return [r for r in results if r is not None]


def answer_probability(resp: dict[str, Any]) -> float | None:
    """P(the whole answer) from Ollama's token log-probs; None when it sent none.
    Trailing whitespace/newline tokens are part of the answer and count too."""
    tokens = resp.get("logprobs")
    if not isinstance(tokens, list) or not tokens:
        return None
    total = 0.0
    for t in tokens:
        lp = t.get("logprob") if isinstance(t, dict) else None
        if not isinstance(lp, (int, float)):
            return None
        total += float(lp)
    return math.exp(total)


def classify_finetuned(
    summaries: list[dict[str, Any]],
    settings: Settings,
    *,
    model: str | None = None,
    chat_fn: ChatFn = chat,
    baseline_fn: Callable[[list[dict[str, Any]]], list[LayerResult]] | None = None,
    on_progress: ProgressFn | None = None,
) -> list[LayerResult]:
    """Labels each layer with the fine-tuned model, using the training prompt (prompt.layer_messages)."""
    model = model or settings.finetuned_model
    results: list[LayerResult] = []
    for s in summaries:
        resp = chat_fn(
            settings.ollama_url,
            model,
            layer_messages(s),
            num_predict=8,  # the longest label is a few tokens
            num_ctx=settings.num_ctx,
            logprobs=True,
            timeout=settings.timeout,
        )
        raw = ((resp.get("message") or {}).get("content") or "").strip()
        first = raw.splitlines()[0] if raw else ""
        results.append(result(str(s.get("name", "")), first or None, answer_probability(resp)))
        if on_progress:
            on_progress(len(results), len(summaries))

    # No log-probs: flag a layer when the baseline disagrees (or when the label always needs a look).
    unsure = [i for i, r in enumerate(results) if r.confidence is None and r.label != "unknown"]
    if unsure:
        baseline = (baseline_fn or (lambda ss: classify_baseline(ss, settings)))([summaries[i] for i in unsure])
        for i, b in zip(unsure, baseline):
            r = results[i]
            r.needs_review = b.label != r.label or needs_review(r.label, 1.0)
            r.must_confirm = must_confirm(r.needs_review)
    return results
