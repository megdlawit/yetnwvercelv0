"""The Modelfile's chat template renders exactly the text the model is trained on."""

from __future__ import annotations

import pytest

from yetnew_layers.chat_format import expected, modelfile_template, render_go_template, render_hf
from yetnew_layers.prompt import layer_messages, training_example

SUMMARY = {"name": "A-FLOR-STRS", "total": 64, "entity_counts": {"LINE": 60, "TEXT": 4}, "blocks": ["STAIR-TREAD"], "texts": ["UP"]}


def test_hugging_face_template_is_plain_chatml_for_our_messages() -> None:
    msgs = layer_messages(SUMMARY)
    assert render_hf(msgs, add_generation_prompt=True) == expected(msgs, True)
    row = training_example(SUMMARY, "stairs")["messages"]
    assert render_hf(row, add_generation_prompt=False) == expected(row, False)
    assert expected(row, False).endswith("<|im_start|>assistant\nstairs<|im_end|>\n")


def test_modelfile_template_renders_the_training_prompt() -> None:
    msgs = layer_messages(SUMMARY)
    rendered = render_go_template(modelfile_template(), msgs)
    assert rendered == render_hf(msgs, add_generation_prompt=True)
    # The fine-tuned answer then continues straight after "<|im_start|>assistant\n".
    assert render_hf(training_example(SUMMARY, "stairs")["messages"], False).startswith(rendered)


def test_modelfile_stops_where_the_training_answer_ends() -> None:
    from yetnew_layers.chat_format import MODELFILE

    text = MODELFILE.read_text(encoding="utf-8")
    assert 'PARAMETER stop "<|im_end|>"' in text
    assert "PARAMETER temperature 0" in text
    assert text.count("\nFROM ") == 1


def test_the_check_refuses_constructs_it_does_not_understand() -> None:
    with pytest.raises(ValueError, match="doesn't support"):
        render_go_template("{{ range .Tools }}x{{ end }}", layer_messages(SUMMARY))


def test_assistant_modelfile_matches_the_layer_modelfile() -> None:
    from yetnew_layers.chat_format import MODELFILE

    assistant = MODELFILE.with_name("Modelfile.assistant")
    assert modelfile_template(assistant) == modelfile_template()
    params = lambda p: sorted(line for line in p.read_text(encoding="utf-8").splitlines() if line.startswith("PARAMETER"))  # noqa: E731
    assert params(assistant) == params(MODELFILE)
    assert "FROM ./yetnew-assistant.Q4_K_M.gguf" in assistant.read_text(encoding="utf-8")
