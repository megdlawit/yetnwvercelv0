"""Retrieved examples for the baseline: neighbours, prompt, token budget, and parity
between what the service sends and what evaluate.py measures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from yetnew_layers import prompt
from yetnew_layers.classify import classify_baseline, plan_batches, retrieved_examples
from yetnew_layers.config import Settings
from yetnew_layers.evaluate import run
from yetnew_layers.prompt import BATCH_SYSTEM, BATCH_SYSTEM_RETRIEVAL, LABEL_GUIDE, batch_messages
from yetnew_layers.retrieval import BankEntry, ExampleBank
from yetnew_layers.summarize import summarize_file

FIXTURE = Path(__file__).parent / "fixtures" / "SYNTHETIC_architect_plan.dxf"


def layer(name: str, entities: dict[str, int], blocks: list[str] | None = None, texts: list[str] | None = None) -> dict[str, Any]:
    return {"name": name, "entity_counts": entities, "blocks": blocks or [], "texts": texts or []}


BANK = ExampleBank([
    BankEntry("venue-a", "wall", layer("A-WALL-EXTR", {"LINE": 400, "LWPOLYLINE": 20})),
    BankEntry("venue-b", "wall", layer("MUR-PORTEUR", {"LINE": 300})),
    BankEntry("venue-a", "door", layer("A-DOOR-FRAM", {"INSERT": 30}, ["DR-900"])),
    BankEntry("venue-c", "vegetation", layer("L-TREE", {"INSERT": 50}, ["TREE-OAK"], ["Oak"])),
    BankEntry("venue-c", "ignore", layer("XYZ", {"VIEWPORT": 1})),
])


def test_nearest_confirmed_layers_are_similar_and_deterministic() -> None:
    q = layer("A-WALL", {"LINE": 812, "LWPOLYLINE": 40})
    near = BANK.nearest(q, 2)
    assert [e.summary["name"] for e in near] == ["A-WALL-EXTR", "MUR-PORTEUR"]
    assert BANK.nearest(q, 2) == near
    assert [e.label for e in BANK.nearest(layer("L-PLNT", {"INSERT": 9}, ["TREE-PALM"]), 1)] == ["vegetation"]
    assert all(e.building_id != "venue-a" for e in BANK.nearest(q, 5, exclude_building="venue-a"))
    assert BANK.nearest(q, 0) == []


def test_retrieval_prompt_shows_labeled_neighbours_with_the_same_guide() -> None:
    summaries = [layer("A-WALL", {"LINE": 812}), layer("L-PLNT", {"INSERT": 9}, ["TREE-PALM"])]
    msgs = batch_messages(summaries, retrieved_examples(summaries, BANK, 2))
    assert msgs[0]["content"] == BATCH_SYSTEM_RETRIEVAL != BATCH_SYSTEM
    for label, (definition, _) in LABEL_GUIDE.items():
        assert f"- {label}: {definition}" in msgs[0]["content"]
    first = json.loads(msgs[1]["content"].splitlines()[2].rstrip(","))
    assert first["layer"] == "A-WALL"
    assert [(s["layer"], s["label"]) for s in first["similar"]] == [("A-WALL-EXTR", "wall"), ("MUR-PORTEUR", "wall")]
    # Examples follow the same text-sample switch as everything else.
    assert prompt.INCLUDE_TEXT_SAMPLES is False
    assert "Oak" not in msgs[1]["content"]
    # Without retrieval the prompt is exactly the plain baseline prompt.
    assert batch_messages(summaries) == batch_messages(summaries, None)
    assert batch_messages(summaries)[0]["content"] == BATCH_SYSTEM


def test_examples_count_against_the_context_window() -> None:
    s = Settings(ollama_url="x", base_model="m", finetuned_model="f", batch_size=100, timeout=5, num_ctx=4096)
    summaries = [layer(f"A-WALL-{i}", {"LINE": 100 + i, "LWPOLYLINE": 5}, ["BLOCK-A", "BLOCK-B"]) for i in range(60)]
    plain = plan_batches(summaries, s)
    with_examples = plan_batches(summaries, s, retrieved_examples(summaries, BANK, 3))
    assert len(with_examples) > len(plain)


def capture() -> tuple[list[list[dict[str, str]]], Any]:
    sent: list[list[dict[str, str]]] = []

    def chat_fn(url: str, model: str, messages: list[dict[str, str]], **kw: Any) -> dict[str, Any]:
        sent.append(messages)
        names = [json.loads(line.rstrip(","))["layer"] for line in messages[1]["content"].splitlines()[2:-1]]
        return {"message": {"content": json.dumps({"layers": [{"name": n, "label": "wall"} for n in names]})}}

    return sent, chat_fn


def test_service_and_evaluate_send_identical_retrieval_prompts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from server import app as app_module

    bank_file = tmp_path / "example_bank.jsonl"
    bank_file.write_text("\n".join(json.dumps({"building_id": e.building_id, "label": e.label, "summary": e.summary})
                                   for e in BANK.entries), encoding="utf-8")
    monkeypatch.setenv("YETNEW_RETRIEVAL_K", "3")
    monkeypatch.setenv("YETNEW_EXAMPLE_BANK", str(bank_file))
    monkeypatch.setenv("YETNEW_BASE_MODEL", "base")

    # The service, as it labels an uploaded drawing.
    service_sent, service_chat = capture()
    real = classify_baseline
    monkeypatch.setattr(app_module, "classify_baseline", lambda ss, st, **kw: real(ss, st, chat_fn=service_chat, **kw))
    monkeypatch.setattr(app_module, "choose_model",
                        lambda st, installed=None: __import__("yetnew_layers.models", fromlist=["ActiveModel"]).ActiveModel("base", "baseline", ""))
    result = app_module.label_file(FIXTURE, lambda d, t: None)
    assert result["retrieval_examples"] == 3

    # evaluate.py, measuring the retrieval option on the same layers with the same bank.
    rows = [{"building_id": "v", "label": "wall", "summary": s} for s in summarize_file(FIXTURE)]
    eval_sent, eval_chat = capture()
    from yetnew_layers.config import load_settings

    run(rows, load_settings(), baseline_model="base", finetuned_model="ft", chat_fn=eval_chat,
        bank=ExampleBank.load(bank_file), retrieval_k=3)
    eval_retrieval = [m for m in eval_sent if m[0]["content"] == BATCH_SYSTEM_RETRIEVAL]

    assert service_sent and all(m[0]["content"] == BATCH_SYSTEM_RETRIEVAL for m in service_sent)
    assert eval_retrieval == service_sent          # byte for byte, batch for batch
    assert any('"similar"' in m[1]["content"] for m in service_sent)


def test_retrieval_is_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    from server import app as app_module
    from yetnew_layers.config import load_settings

    monkeypatch.delenv("YETNEW_RETRIEVAL_K", raising=False)
    assert load_settings().retrieval_k == 0
    assert app_module.load_bank(load_settings()) is None


def test_retrieval_is_a_headline_number_only_without_same_venue_examples() -> None:
    from yetnew_layers.evaluate import decide, per_label_table

    # The bank holds layers of the very venue being scored ("v1") as well as others.
    bank = ExampleBank([*BANK.entries,
                        BankEntry("v1", "wall", layer("A-WALL", {"LINE": 812})),
                        BankEntry("v1", "door", layer("A-DOOR", {"INSERT": 9}, ["DR-900"]))])
    rows = [{"building_id": "v1", "label": "wall", "summary": layer("A-WALL", {"LINE": 812})},
            {"building_id": "v1", "label": "door", "summary": layer("A-DOOR", {"INSERT": 9}, ["DR-900"])}]
    sent, chat_fn = capture()
    s = Settings(ollama_url="x", base_model="base", finetuned_model="ft", batch_size=10, timeout=5)

    def ft_chat(url: str, model: str, messages: list[dict[str, str]], **kw: Any) -> dict[str, Any]:
        if model == "ft":
            return {"message": {"content": "wall"}, "logprobs": [{"logprob": -0.1}]}
        return chat_fn(url, model, messages, **kw)

    clean = run(rows, s, baseline_model="base", finetuned_model="ft", chat_fn=ft_chat, bank=bank, retrieval_k=3)
    assert "retrieval" in clean and "retrieval_diagnostic" not in clean
    assert "every retrieved example came from a different venue" in clean["retrieval"].note
    retrieval_prompts = [m for m in sent if m[0]["content"] == BATCH_SYSTEM_RETRIEVAL]
    shown = [s_["layer"] for m in retrieval_prompts for line in m[1]["content"].splitlines()[2:-1]
             for s_ in json.loads(line.rstrip(",")).get("similar", [])]
    assert shown and "A-DOOR" not in shown          # v1's own A-DOOR was never offered as a hint

    leaky = run(rows, s, baseline_model="base", finetuned_model="ft", chat_fn=ft_chat, bank=bank, retrieval_k=3,
                exclude_same_venue=False)
    assert "retrieval" not in leaky and "retrieval_diagnostic" in leaky
    assert leaky["retrieval_diagnostic"].note.startswith("DIAGNOSTIC ONLY")
    # Never in the side-by-side table or any comparison.
    assert "retrieval" not in per_label_table(leaky, "baseline")[0]
    manifest = {"synthetic": False, "prompt_version": prompt.PROMPT_VERSION, "include_text_samples": False,
                "venues": {"train": [], "val": ["v1"]}}
    assert decide(manifest, rows, leaky, reference="baseline", template=(True, "")).comparison.reference == "baseline"
