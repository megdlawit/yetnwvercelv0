"""The free local assistant: same contract as the Claude route, validated answers,
training/inference parity, and the generated data."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from yetnew_layers.assistant import (
    assistant_messages,
    canonical_answer,
    clean_action,
    fitted_user_message,
    local_schema,
    parse_answer,
    spec,
    training_example,
    user_message,
)
from yetnew_layers.assistant_data import HELD_OUT, T, generate, split_templates, typo

ML = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ML / "assistant" / "messages_fixture.json").read_text(encoding="utf-8"))


def test_same_message_as_the_claude_route_for_every_fixture() -> None:
    # messages_fixture.json is written by src/lib/assistant/assistantSpec.test.ts from the TypeScript builder.
    assert len(FIXTURE) >= 6
    for case in FIXTURE:
        assert user_message(case["body"]) == case["message"]


def test_same_instructions_and_actions_as_the_claude_route() -> None:
    s = spec()
    ts = (ML.parent / "src" / "lib" / "assistant" / "assistantSpec.ts").read_text(encoding="utf-8")
    assert s["system"].split("\n")[0] in ts
    assert len(s["ops"]) == 32 and "connect" in s["ops"] and s["fields"][0] == "from"
    items = local_schema()["properties"]["actions"]["items"]
    assert list(items["properties"])[0] == "op" and items["required"] == ["op"]
    assert items["properties"]["width"] == {"type": "number"}
    assert items["properties"]["side"]["enum"] == ["left", "right", "up", "down"]


def test_answers_are_validated_before_the_editor_sees_them() -> None:
    assert clean_action({"op": "connect", "from": "Cafe", "to": "Lobby", "accessible": None}) == {"op": "connect", "from": "Cafe", "to": "Lobby"}
    assert clean_action({"op": "teleport", "target": "Cafe"}) is None                         # not an action
    assert clean_action({"op": "move", "target": "Cafe", "direction": "sideways"}) == {"op": "move", "target": "Cafe"}
    assert clean_action({"op": "resize", "target": "Cafe", "scale": "big", "width": True}) == {"op": "resize", "target": "Cafe"}
    assert clean_action({"op": "rename", "name": "X", "target": "Y", "hack": 1}) == {"op": "rename", "target": "Y", "name": "X"}
    actions, reply, valid = parse_answer('{"actions": [{"op": "undo"}, {"op": "nope"}], "reply": "  "}')
    assert (actions, reply, valid) == ([{"op": "undo"}], None, True)
    assert parse_answer("not json") == ([], None, False)


def test_training_row_is_the_inference_prompt_plus_the_answer() -> None:
    body = FIXTURE[0]["body"]
    row = training_example(body, [{"to": "Main Entrance", "from": "Cafe", "op": "connect"}], None)
    assert row["messages"][:2] == assistant_messages(body)
    assert row["messages"][2] == {"role": "assistant", "content": '{"actions": [{"op": "connect", "from": "Cafe", "to": "Main Entrance"}], "reply": null}'}
    assert json.loads(canonical_answer([], "Which place?")) == {"actions": [], "reply": "Which place?"}


def test_big_maps_are_trimmed_to_fit_the_context_window() -> None:
    body = {"text": "fix everything", "context": {"brief": "- Room | office | 4×4 | 1,1 | yes\n" * 2000}}
    small = fitted_user_message(body, 4096)
    assert len(small) < len(user_message(body)) and small.endswith("They said: fix everything")
    assert fitted_user_message(FIXTURE[0]["body"], 8192) == user_message(FIXTURE[0]["body"])   # small maps untouched


def test_generated_data_holds_out_whole_phrasings_and_is_deterministic() -> None:
    train, test, manifest = generate(300, 80)
    held = set(manifest["held_out_templates"])
    assert held and {r["template"] for r in test} <= held
    assert not ({r["template"] for r in train} & held)
    assert manifest["synthetic"] is True
    again, _, _ = generate(300, 80)
    assert [r["messages"] for r in again[:20]] == [r["messages"] for r in train[:20]]
    assert held == HELD_OUT                                                 # frozen: test sets stay comparable
    assert set(generate(50, 10, seed="another-seed")[2]["held_out_templates"]) == split_templates(T, "another-seed")  # other experiments split anew


def test_behaviours_whose_test_phrasing_is_held_out_are_still_trained() -> None:
    train, _, _ = generate(1500, 10)
    texts = {r["template"].split(".")[0] for r in train}
    assert {"ask_back", "it_near", "it_remove", "this_near"} <= texts
    asked = [r for r in train if r["op"] == "reply" and r["template"].startswith("ask_back")]
    assert asked and all(r["actions"] == [] and r["body"]["context"]["selection"] is None and r["body"]["context"]["last"] is None
                         for r in asked)                                    # asking back only when nothing is meant
    it_rows = [r for r in train if r["template"].startswith("it_")]
    assert it_rows and all(r["body"]["context"]["last"] and r["body"]["history"] for r in it_rows)


def test_generated_labels_only_name_places_on_the_map() -> None:
    train, test, _ = generate(400, 100)
    for r in train + test:
        names = set(r["body"]["context"]["places"])
        for a in r["actions"]:
            for f in ("from", "to", "a", "b", "target"):
                if f in a:
                    assert a[f] in names | {"this", "it", "walls", "all"}, (r["body"]["text"], a)
            if "near" in a:
                assert a["near"] in names | {"here"}, (r["body"]["text"], a)
        # The answer the model learns is valid under the local schema.
        content = json.loads(r["messages"][2]["content"])
        assert all(clean_action(a) == a for a in content["actions"])
        assert r["messages"][:2] == assistant_messages(r["body"])


def test_typos_never_touch_place_names() -> None:
    import random

    rng = random.Random(3)
    for _ in range(200):
        out = typo("please connect Gift Shop to Main Entrance quickly", rng, ["Gift Shop", "Main Entrance"])
        assert "Gift Shop" in out and "Main Entrance" in out


def test_every_action_has_training_and_test_examples() -> None:
    train, test, manifest = generate(2500, 300)
    ops_train = set(manifest["ops"]["train"])
    many = {t.op for t in T if sum(x.op == t.op for x in T) >= 3}
    assert many <= ops_train and many <= set(manifest["ops"]["test"])
    covered = set(spec()["ops"]) & ops_train
    assert len(covered) >= 25


def test_scoring_and_switch_rule() -> None:
    from yetnew_layers.assistant_eval import MIN_EXAMPLES, Case, decide, report, same_action

    assert same_action({"op": "connect", "from": "cafe", "to": "LOBBY"}, {"op": "connect", "from": "Cafe", "to": "Lobby"})
    assert same_action({"op": "resize", "target": "A", "scale": 1.26}, {"op": "resize", "target": "A", "scale": 1.25})
    assert not same_action({"op": "connect", "from": "Cafe", "to": "Lobby", "accessible": True}, {"op": "connect", "from": "Cafe", "to": "Lobby"})
    asked = Case("q.0", "reply", "connect them", [], True, [], "Which place?", True)
    guessed = Case("q.0", "reply", "connect them", [], True, [{"op": "connect", "from": "A", "to": "B"}], None, True)
    assert asked.exact and not guessed.exact and not guessed.ops_right

    def cases(right_every: int, n: int = 240) -> list:
        out = []
        for i in range(n):
            want = [{"op": "remove", "target": "X"}] if i % 4 == 0 else [{"op": "undo"}]
            got = want if i % right_every else [{"op": "redo"}]
            out.append(Case(f"t{i % 40}", want[0]["op"], "…", want, False, got, None, True))
        return out

    rows = [{"template": f"t{i % 40}"} for i in range(240)]
    base, better = report("base", cases(3)), report("ft", cases(1000))
    assert MIN_EXAMPLES == 200
    d = decide(rows, base, better, template=(True, ""))
    assert d.winner == "finetuned" and d.can_write and d.ci[0] > 0
    assert decide(rows, better, base, template=(True, "")).winner == "base"
    assert "template check" in " ".join(decide(rows, base, better, template=(False, "stale")).reasons)
    assert "120 test requests" in " ".join(decide(rows[:120], report("b", cases(3, 120)), report("f", cases(1000, 120)), template=(True, "")).reasons)


def test_worked_examples_come_from_training_phrasings_and_fit_the_window() -> None:
    from yetnew_layers.assistant import ExampleBank, example_turns

    train, test, manifest = generate(400, 60)
    bank = ExampleBank(train)
    assert not bank.templates() & set(manifest["held_out_templates"])          # no test phrasing can be shown
    picked = bank.nearest("hey call Main Gate Book Shop instead", 4)
    assert len(picked) == 4 and len({p["template"] for p in picked}) == 4       # one per phrasing, varied
    assert any("rename" in p["template"] for p in picked)                    # rename, it_rename, this_rename
    body = test[0]["body"]
    with_examples = assistant_messages(body, 8192, picked)
    assert with_examples[0] == assistant_messages(body)[0]                       # instructions first, unchanged
    assert with_examples[1:-1] == example_turns(picked) and len(with_examples) == 2 + 2 * 4
    assert with_examples[-1]["content"].endswith(f"They said: {body['text']}")
    assert all(t["content"].startswith("Example request.") for t in with_examples[1:-1:2])
    # On a tight window the map summary gives way to the examples, never the request itself.
    tight = assistant_messages({**body, "context": {**body["context"], "brief": body["context"]["brief"] * 40}}, 4096, picked)
    assert tight[-1]["content"].endswith(f"They said: {body['text']}")


def test_examples_are_only_used_when_asked() -> None:
    from yetnew_layers.assistant import ExampleBank, ask
    from yetnew_layers.config import Settings

    train, test, _ = generate(200, 10)
    seen: list[int] = []

    def fake_chat(url: str, model: str, messages: list[dict[str, str]], **kw: object) -> dict:
        seen.append(len(messages))
        return {"message": {"content": '{"actions": [{"op": "undo"}], "reply": null}'}}

    s = Settings(ollama_url="x", base_model="m", finetuned_model="f", batch_size=1, timeout=1)
    assert ask(test[0]["body"], s, "m", chat_fn=fake_chat)["actions"] == [{"op": "undo"}]
    ask(test[0]["body"], s, "m", chat_fn=fake_chat, bank=ExampleBank(train), examples_k=3, examples_mode="nearest")
    menu = ExampleBank(train).menu()
    ask(test[0]["body"], s, "m", chat_fn=fake_chat, bank=ExampleBank(train), examples_k=1)          # default mode: the menu
    assert seen == [2, 8, 2 + 2 * len(menu)]


def test_schema_is_sent_unless_switched_off() -> None:
    from yetnew_layers.assistant import ask, local_schema
    from yetnew_layers.config import Settings

    _, test, _ = generate(50, 5)
    formats: list[object] = []

    def fake_chat(url: str, model: str, messages: list[dict[str, str]], **kw: object) -> dict:
        formats.append(kw.get("format"))
        # Free answers are validated the same way: unknown fields are dropped.
        return {"message": {"content": '{"actions": [{"op": "setting", "setting": "grid", "on": true, "bogus": 1}], "reply": null}'}}

    s = Settings(ollama_url="x", base_model="m", finetuned_model="f", batch_size=1, timeout=1)
    assert ask(test[0]["body"], s, "m", chat_fn=fake_chat)["actions"] == [{"op": "setting", "setting": "grid", "on": True}]
    assert ask(test[0]["body"], s, "f", chat_fn=fake_chat, schema=False)["actions"] == [{"op": "setting", "setting": "grid", "on": True}]
    assert formats == [local_schema(), None]


def test_menu_has_one_clean_example_per_action() -> None:
    from yetnew_layers.assistant import ExampleBank

    train, _, _ = generate(2500, 10)
    menu = ExampleBank(train).menu()
    ops = [(e["actions"][0]["op"] if e["actions"] else "reply") for e in menu]
    assert len(ops) == len(set(ops)) >= 30                       # every kind of action, once
    assert all(e["clean"] for e in menu)                          # no filler, no typos
    assert {"undo", "redo", "open", "go_floor", "fix_all"} <= set(ops)
    assert menu == ExampleBank(train).menu()                      # fixed: same for every request


def test_interrupted_evaluation_resumes_from_saved_answers(tmp_path: Path) -> None:
    from yetnew_layers.assistant_eval import AnswerCache, run_model

    _, test, _ = generate(50, 6)
    calls: list[str] = []

    def ask_fn(body: dict, model: str) -> dict:
        calls.append(body["text"])
        if len(calls) == 4:
            raise KeyboardInterrupt  # the laptop sleeps / the session ends mid-run
        return {"actions": [{"op": "undo"}], "reply": None, "valid": True}

    path = tmp_path / "answers.jsonl"
    try:
        run_model(test, "m", ask_fn, cache=AnswerCache(path), setup="m")
    except KeyboardInterrupt:
        pass
    assert len(path.read_text(encoding="utf-8").splitlines()) == 3          # saved as they arrived
    calls.clear()
    done = run_model(test, "m", lambda b, m: {"actions": [], "reply": "x", "valid": True}, cache=AnswerCache(path), setup="m")
    assert done.n == 6
    assert len(path.read_text(encoding="utf-8").splitlines()) == 6           # only the 3 missing ones were asked
    # A different setup (e.g. with worked examples) never reuses these answers.
    asked: list[str] = []
    run_model(test[:2], "m", lambda b, m: asked.append(b["text"]) or {"actions": [], "reply": "y", "valid": True},
              cache=AnswerCache(path), setup="m+examples")
    assert len(asked) == 2 and len(path.read_text(encoding="utf-8").splitlines()) == 8


def test_v3_phrasings_teach_rename_bigger_and_words_not_actions() -> None:
    train, _, manifest = generate(3000, 10)
    by = lambda prefix: [r for r in train if r["template"].startswith(prefix)]  # noqa: E731
    assert by("rename_kindlike") and all(r["actions"][0]["op"] == "rename" for r in by("rename_kindlike"))
    assert by("bigger_the") and all(r["actions"] == [{"op": "resize", "target": r["actions"][0]["target"], "scale": 1.25}] for r in by("bigger_the"))
    # Small talk and questions about Yet New: a reply in words, never an action.
    words = by("casual") + by("known")
    assert words and all(r["actions"] == [] and r["reply"] for r in words)
    assert not {r["template"] for r in train} & set(manifest["held_out_templates"])
