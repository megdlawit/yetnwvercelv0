"""The Colab notebook keeps its guarantees (it can't be run here: no GPU)."""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

from yetnew_layers.chat_format import expected
from yetnew_layers.prompt import training_example

NB = Path(__file__).resolve().parents[1] / "notebooks" / "train_yetnew_layers.ipynb"


def without_shell_lines(src: str) -> str:
    """The notebook's Python, without shell lines (!pip …) and their continuations."""
    return re.sub(r"^!(?:.*\\\n)*.*$", "", src, flags=re.M)


def code() -> str:
    nb = json.loads(NB.read_text(encoding="utf-8"))
    return "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")


def test_defaults_base_3b_two_to_three_epochs_q4_k_m() -> None:
    src = code()
    assert 'BASE_MODEL = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit"' in src
    epochs = int(re.search(r"^EPOCHS = (\d+)", src, re.M).group(1))  # type: ignore[union-attr]
    assert 2 <= epochs <= 3
    assert 'quantization_method="q4_k_m"' in src


def test_refuses_synthetic_data_and_venue_overlap() -> None:
    src = code()
    assert 'assert manifest["synthetic"] is False' in src
    assert 'set(manifest["venues"]["train"]) & set(manifest["venues"]["val"])' in src


def test_every_package_is_pinned() -> None:
    install = next(line for line in code().split("\n!pip")[1:2])
    for pkg in ("unsloth", "unsloth_zoo", "trl", "transformers", "peft", "datasets", "bitsandbytes", "accelerate", "gguf"):
        assert re.search(rf'"{pkg}==[\d.]+"', install), f"{pkg} is not pinned"


def test_notebook_format_check_matches_the_service_format() -> None:
    python = without_shell_lines(code())
    tree = ast.parse(python)
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "expected")
    scope: dict = {}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "notebook", "exec"), scope)
    row = training_example({"name": "A-WALL", "entity_counts": {"LINE": 9}, "blocks": [], "texts": []}, "wall")["messages"]
    for gen in (False, True):
        msgs = row[:2] if gen else row
        assert scope["expected"](msgs, gen) == expected(msgs, gen)


def test_smoke_mode_is_off_by_default_and_can_never_reach_the_service() -> None:
    src = code()
    assert re.search(r"^SMOKE_TEST = False", src, re.M)
    assert 'OUTPUT_NAME = "SMOKE-TEST-delete-me" if SMOKE_TEST else "yetnew-layers"' in src
    # Smoke mode runs on the synthetic dry run only…
    assert 'assert manifest["synthetic"] is True, "Smoke mode runs on the SYNTHETIC dry-run export only' in src
    assert "max_steps=SMOKE_STEPS if SMOKE_TEST else -1" in src
    # …and stops before anything is saved, converted or downloaded, telling you to delete it.
    export = src[src.index("if SMOKE_TEST:\n    raise SystemExit("):]
    stop = export.index("raise SystemExit(")
    for action in ("save_pretrained(", "save_pretrained_gguf(", "files.download("):
        assert export.index(action) > stop
    assert "DELETE IT NOW" in export[:export.index("save_pretrained(")]


def test_service_and_evaluate_refuse_smoke_models() -> None:
    from yetnew_layers.config import Settings
    from yetnew_layers.models import choose_model

    s = Settings(ollama_url="x", base_model="b", finetuned_model="SMOKE-TEST-delete-me", batch_size=1, timeout=1, model_mode="finetuned")
    assert choose_model(s, installed=lambda: ["SMOKE-TEST-delete-me"], template_ok=lambda m: (True, "")).kind == "baseline"
    evaluate_src = (Path(__file__).resolve().parents[1] / "scripts" / "evaluate.py").read_text(encoding="utf-8")
    assert 'if "smoke" in args.finetuned.lower():' in evaluate_src


ASSISTANT_NB = Path(__file__).resolve().parents[1] / "notebooks" / "train_map_assistant.ipynb"


def assistant_code() -> str:
    nb = json.loads(ASSISTANT_NB.read_text(encoding="utf-8"))
    return "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")


def test_assistant_notebook_keeps_the_same_guarantees() -> None:
    src = assistant_code()
    assert 'BASE_MODEL = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit"' in src and 'quantization_method="q4_k_m"' in src
    assert 2 <= int(re.search(r"^EPOCHS = (\d+)", src, re.M).group(1)) <= 3  # type: ignore[union-attr]
    for pkg in ("unsloth", "unsloth_zoo", "trl", "transformers", "peft", "datasets", "bitsandbytes", "accelerate", "gguf"):
        assert re.search(rf'"{pkg}==[\d.]+"', src), pkg
    # Same pins as the layer notebook.
    pins = lambda s: sorted(re.findall(r'"([a-z_]+==[\d.]+)"', s))  # noqa: E731
    assert pins(src) == pins(code())
    assert re.search(r"^SMOKE_TEST = False", src, re.M) and '"SMOKE-TEST-delete-me-assistant" if SMOKE_TEST else "yetnew-assistant"' in src
    export = src[src.index("if SMOKE_TEST:\n    raise SystemExit("):]
    stop = export.index("raise SystemExit(")
    assert all(export.index(a) > stop for a in ("save_pretrained(", "save_pretrained_gguf(", "files.download("))
    assert 'assert not {r["template"] for r in train_rows} & held' in src        # held-out phrasings never trained on


def test_assistant_notebook_format_check_matches_the_service() -> None:
    python = without_shell_lines(assistant_code())
    fn = next(n for n in ast.walk(ast.parse(python)) if isinstance(n, ast.FunctionDef) and n.name == "expected")
    scope: dict = {}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "notebook", "exec"), scope)
    from yetnew_layers.assistant import training_example as assistant_example

    row = assistant_example({"text": "undo", "context": {}}, [{"op": "undo"}], None)["messages"]
    assert scope["expected"](row, False) == expected(row, False)
