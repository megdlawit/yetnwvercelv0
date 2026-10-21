import json
import math
import re
from typing import Any

import httpx
import pytest

from yetnew_layers.classify import classify_baseline, label_probabilities, parse_batch_answer, plan_batches
from yetnew_layers.config import Settings
from yetnew_layers.ollama import OllamaError, OllamaUnavailable, chat, list_models
from yetnew_layers import prompt
from yetnew_layers.prompt import (
    BATCH_SCHEMA,
    LABEL_GUIDE,
    LAYER_SYSTEM,
    MAX_NAME_CHARS,
    MAX_TEXT_CHARS,
    TEMPLATE_TOKENS,
    batch_messages,
    estimate_tokens,
    layer_messages,
    layer_payload,
    training_example,
)

SETTINGS = Settings(ollama_url="http://127.0.0.1:9", base_model="test-model", finetuned_model="ft", batch_size=2, timeout=5)


def summaries(*names: str) -> list[dict[str, Any]]:
    return [{"name": n, "total": 1, "entity_counts": {"LINE": 1}, "blocks": [], "texts": []} for n in names]


def ollama_answer(items: list[tuple[str, str, float]], *, punct_logprob: float = 0.0) -> dict[str, Any]:
    """A fake Ollama response: the JSON answer plus log-probs, with each label value
    as its own token of probability p and every other token at `punct_logprob`."""
    content = json.dumps({"layers": [{"name": n, "label": label} for n, label, _ in items]})
    probs = iter(p for _, _, p in items)
    tokens: list[dict[str, Any]] = []
    pos = 0
    for m in re.finditer(r'"label": "([^"]*)"', content):
        tokens.append({"token": content[pos : m.start(1)], "logprob": punct_logprob})
        tokens.append({"token": m.group(1), "logprob": math.log(next(probs))})
        pos = m.end(1)
    tokens.append({"token": content[pos:], "logprob": punct_logprob})
    return {"message": {"content": content}, "logprobs": tokens}


def parse(items: list[tuple[str, str, float]], names: list[str]) -> list[Any]:
    resp = ollama_answer(items)
    return parse_batch_answer(resp["message"]["content"], names, label_probabilities(resp))


def test_confidence_is_the_label_tokens_probability() -> None:
    [r] = parse([("A-WALL", "wall", 0.95)], ["A-WALL"])
    assert (r.label, r.confidence, r.needs_review, r.must_confirm) == ("wall", 0.95, False, True)


def test_formatting_tokens_do_not_count() -> None:
    resp = ollama_answer([("A", "wall", 0.9), ("B", "door", 0.5)], punct_logprob=-5.0)
    assert label_probabilities(resp) == pytest.approx([0.9, 0.5])


def test_label_split_across_tokens_multiplies() -> None:
    content = '{"layers": [{"name": "X", "label": "vegetation"}]}'
    head, tail = content.split("vegetation")
    resp = {"message": {"content": content}, "logprobs": [
        {"token": head[:-1], "logprob": -9.0},
        {"token": '"veg', "logprob": math.log(0.8)},   # opening quote merged into the first piece
        {"token": "etation", "logprob": math.log(0.5)},
        {"token": tail, "logprob": -9.0},
    ]}
    assert label_probabilities(resp) == pytest.approx([0.4])


def test_invalid_label_missing_layer_and_low_confidence() -> None:
    a, b, c = parse([("A", "walls", 0.99), ("C", "door", 0.4)], ["A", "B", "C"])
    assert (a.label, a.confidence, a.needs_review) == ("unknown", 0.0, True)  # not in the list
    assert (b.label, b.confidence, b.needs_review) == ("unknown", 0.0, True)  # skipped by the model
    assert (c.label, c.confidence, c.needs_review) == ("door", 0.4, True)     # unsure


def test_always_confirm_labels_are_flagged_even_when_sure() -> None:
    results = parse([("X", "unknown", 0.99), ("Y", "ignore", 0.99), ("Z", "walkable", 0.99)], ["X", "Y", "Z"])
    assert [(r.confidence, r.needs_review) for r in results] == [(0.99, True)] * 3


def test_no_logprobs_means_no_confidence_and_flagged() -> None:
    [r] = parse_batch_answer(json.dumps({"layers": [{"name": "A", "label": "wall"}]}), ["A"], None)
    assert (r.label, r.confidence, r.needs_review) == ("wall", None, True)


def test_names_match_case_insensitively() -> None:
    [r] = parse([("a-wall", "wall", 0.9)], ["A-WALL"])
    assert (r.label, r.confidence) == ("wall", 0.9)


def test_non_json_answer_makes_everything_unknown() -> None:
    results = parse_batch_answer("Sure! Here are the labels: wall, door", ["A", "B"])
    assert [r.label for r in results] == ["unknown", "unknown"]
    assert all(r.needs_review for r in results)


def test_classify_batches_keeps_order_and_asks_for_logprobs() -> None:
    calls: list[list[str]] = []

    def fake_chat(url: str, model: str, messages: list[dict[str, str]], **kw: Any) -> dict[str, Any]:
        assert kw["format"] == BATCH_SCHEMA and kw["logprobs"] is True and model == "test-model"
        names = [json.loads(line.rstrip(","))["layer"] for line in messages[1]["content"].splitlines()[2:-1]]
        calls.append(names)
        return ollama_answer([(n, "wall", 0.9) for n in reversed(names)])

    results = classify_baseline(summaries("L1", "L2", "L3"), SETTINGS, chat_fn=fake_chat)
    assert calls == [["L1", "L2"], ["L3"]]
    assert [(r.name, r.confidence) for r in results] == [("L1", 0.9), ("L2", 0.9), ("L3", 0.9)]


def test_ollama_down_gives_a_clear_error() -> None:
    with pytest.raises(OllamaUnavailable, match="ollama serve"):
        chat("http://127.0.0.1:9", "m", [{"role": "user", "content": "hi"}], timeout=2)
    with pytest.raises(OllamaUnavailable):
        list_models("http://127.0.0.1:9", timeout=2)


def test_unknown_model_gives_a_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(404, text="model not found"))
    with pytest.raises(OllamaError, match="ollama pull"):
        chat("http://x", "nope:1b", [{"role": "user", "content": "hi"}])


def test_training_example_is_the_inference_prompt_plus_the_answer() -> None:
    s = summaries("A-WALL")[0]
    ex = training_example(s, "wall")
    assert ex["messages"][:-1] == layer_messages(s)
    assert ex["messages"][-1] == {"role": "assistant", "content": "wall"}


def test_fine_tuned_prompt_carries_the_label_guide() -> None:
    # The training notebook builds rows with training_example, so the definitions reach training too.
    for label, (definition, _) in LABEL_GUIDE.items():
        assert f"- {label}: {definition}" in LAYER_SYSTEM


# ── Context window: caps, planning, cut-off answers ─────────────────────────

def huge(name: str) -> dict[str, Any]:
    """A layer far bigger than any real summary: long name, many long blocks and texts."""
    return {
        "name": name + "-" + "X" * 300,
        "entity_counts": {f"TYPE{i}": 1000 + i for i in range(12)},
        "blocks": [f"BLOCK-{i}-" + "B" * 200 for i in range(30)],
        "texts": [f"Text {i} " + "very long annotation " * 40 for i in range(30)],
    }


def test_long_names_blocks_and_texts_are_cut(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(prompt, "INCLUDE_TEXT_SAMPLES", True)
    p = layer_payload(huge("L"))
    assert len(p["layer"]) == MAX_NAME_CHARS
    assert len(p["entities"]) == 4
    assert len(p["blocks"]) == 5 and all(len(b) <= 40 for b in p["blocks"])
    assert len(p["texts"]) == 5 and all(len(t) <= MAX_TEXT_CHARS for t in p["texts"])


def test_text_samples_are_off_by_default_everywhere() -> None:
    assert prompt.INCLUDE_TEXT_SAMPLES is False
    s = {"name": "A-ROOM-NAME", "entity_counts": {"TEXT": 12}, "blocks": [], "texts": ["Lobby", "Café"]}
    assert layer_payload(s)["texts"] == []
    assert "Lobby" not in batch_messages([s])[1]["content"]
    assert "Lobby" not in layer_messages(s)[1]["content"]


@pytest.mark.parametrize("include", [False, True])
def test_training_row_user_message_equals_the_inference_message(monkeypatch: pytest.MonkeyPatch, include: bool) -> None:
    monkeypatch.setattr(prompt, "INCLUDE_TEXT_SAMPLES", include)
    # What the service summarizes at inference, and the same layer as the training
    # export returns it (texts removed by the database unless the setting is on).
    live = {"name": "A-ROOM-NAME", "total": 14, "entity_counts": {"TEXT": 12, "LINE": 2}, "blocks": ["TAG"], "texts": ["Lobby", "Café"]}
    exported = {**live, "texts": live["texts"] if include else []}
    row = training_example(exported, "text")["messages"]
    asked = layer_messages(live)
    assert [m["role"] for m in row] == ["system", "user", "assistant"]
    assert row[0] == asked[0]           # same system prompt (label guide included)
    assert row[1] == asked[1]           # same user message, byte for byte
    assert ("Lobby" in asked[1]["content"]) is include


def test_oversized_batch_is_split_to_fit_the_context_window() -> None:
    settings = Settings(ollama_url="http://x", base_model="m", finetuned_model="ft", batch_size=100, timeout=5, num_ctx=4096)
    layers = [huge(f"L{i}") for i in range(80)]
    seen: list[tuple[int, int, int]] = []

    def fake_chat(url: str, model: str, messages: list[dict[str, str]], **kw: Any) -> dict[str, Any]:
        assert kw["num_ctx"] == 4096
        names = [json.loads(line.rstrip(","))["layer"] for line in messages[1]["content"].splitlines()[2:-1]]
        prompt = estimate_tokens(messages[0]["content"] + messages[1]["content"]) + TEMPLATE_TOKENS
        seen.append((len(names), prompt, kw["num_predict"]))
        return ollama_answer([(n, "wall", 0.9) for n in names])

    results = classify_baseline(layers, settings, chat_fn=fake_chat)
    assert len(seen) > 1                                    # one batch would not fit
    assert all(prompt + predict <= 4096 for _, prompt, predict in seen)
    assert sum(n for n, _, _ in seen) == 80
    # Every layer comes back, in order, under its full (uncut) name.
    assert [r.name for r in results] == [s["name"] for s in layers]
    assert all(r.label == "wall" for r in results)


def test_cut_off_answer_is_split_and_retried() -> None:
    calls: list[int] = []

    def fake_chat(url: str, model: str, messages: list[dict[str, str]], **kw: Any) -> dict[str, Any]:
        names = [json.loads(line.rstrip(","))["layer"] for line in messages[1]["content"].splitlines()[2:-1]]
        calls.append(len(names))
        if len(names) > 2:
            return {"message": {"content": '{"layers": [{"name": "L0", "lab'}, "done_reason": "length"}
        return ollama_answer([(n, "door", 0.8) for n in names])

    settings = Settings(ollama_url="http://x", base_model="m", finetuned_model="ft", batch_size=8, timeout=5)
    results = classify_baseline(summaries(*[f"L{i}" for i in range(8)]), settings, chat_fn=fake_chat)
    assert calls == [8, 4, 2, 2, 4, 2, 2]
    assert [r.label for r in results] == ["door"] * 8


def test_progress_is_reported_per_batch() -> None:
    progress: list[tuple[int, int]] = []
    fake = lambda url, model, messages, **kw: ollama_answer(  # noqa: E731
        [(json.loads(line.rstrip(","))["layer"], "wall", 0.9) for line in messages[1]["content"].splitlines()[2:-1]])
    classify_baseline(summaries("A", "B", "C"), SETTINGS, chat_fn=fake, on_progress=lambda d, t: progress.append((d, t)))
    assert progress == [(2, 3), (3, 3)]


def test_context_window_smaller_than_the_prompt_is_refused() -> None:
    settings = Settings(ollama_url="http://x", base_model="m", finetuned_model="ft", batch_size=8, timeout=5, num_ctx=256)
    with pytest.raises(ValueError, match="YETNEW_NUM_CTX"):
        plan_batches(summaries("A"), settings)


def test_empty_layers_are_ignore_without_asking_the_model() -> None:
    from yetnew_layers.classify import LayerResult, result, skip_empty

    summaries = [{"name": "A-WALL", "total": 9}, {"name": "Layer131B", "total": 0}, {"name": "A-DOOR", "total": 2}, {"name": "X"}]
    asked: list[str] = []

    def fake(used: list[dict]) -> list[LayerResult]:
        asked.extend(s["name"] for s in used)
        return [result(s["name"], "wall", 0.9) for s in used]

    out = skip_empty(summaries, fake)
    assert asked == ["A-WALL", "A-DOOR"]                                   # only layers that hold something
    assert [r.name for r in out] == ["A-WALL", "Layer131B", "A-DOOR", "X"]  # order kept
    assert [r.label for r in out] == ["wall", "ignore", "wall", "ignore"]
    assert skip_empty([{"name": "E", "total": 0}], lambda used: (_ for _ in ()).throw(AssertionError("model asked"))) [0].label == "ignore"


def test_layers_the_rules_are_sure_about_are_not_sent_to_the_model() -> None:
    from yetnew_layers.classify import LayerResult, result, skip_empty

    summaries = [{"name": "A-DOOR", "total": 4}, {"name": "Plan 1", "total": 45}, {"name": "E", "total": 0}, {"name": "Bad", "total": 3}]
    asked: list[str] = []

    def fake(used: list[dict]) -> list[LayerResult]:
        asked.extend(s["name"] for s in used)
        return [result(s["name"], "wall", 0.8) for s in used]

    out = {r.name: r for r in skip_empty(summaries, fake, {"A-DOOR": "door", "Bad": "not-a-label"})}
    assert asked == ["Plan 1", "Bad"]                                       # an invalid rule label is ignored
    assert (out["A-DOOR"].label, out["A-DOOR"].source, out["A-DOOR"].confidence) == ("door", "rules", None)
    assert (out["E"].label, out["E"].source) == ("ignore", "empty")
    assert (out["Plan 1"].source, out["Bad"].source) == ("model", "model")
