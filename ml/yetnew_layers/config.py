"""Settings, all from environment variables (with defaults for local use)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    #: Where Ollama listens.
    ollama_url: str
    #: The zero-shot model (any instruct model in Ollama). Default 3B: it fits
    #: the CPU machines inference runs on (7B needs ~5.5 GB free RAM).
    base_model: str
    #: The fine-tuned model's name in Ollama (created from the GGUF).
    finetuned_model: str
    #: Layers per baseline request; smaller batches are slower but sturdier on small models.
    batch_size: int
    #: Seconds to wait for one Ollama answer (CPU inference is slow).
    timeout: float
    #: Ollama context window (tokens), set on every request so prompts are never
    #: cut silently. Batches are planned to fit it (classify.plan_batches).
    num_ctx: int = 8192
    #: "auto" (fine-tuned when installed AND approved by evaluate.py), "baseline" or "finetuned".
    model_mode: str = "auto"
    #: Written by scripts/evaluate.py: which model won on held-out venues.
    choice_file: Path = ML_DIR / "model_choice.json"
    #: Written by scripts/check_template.py: models whose chat format was verified,
    #: per Ollama version and model digest. Stale after `ollama create` or an Ollama upgrade.
    template_check_file: Path = ML_DIR / "template_check.json"
    #: Retrieved examples for the baseline: confirmed layers from other venues shown
    #: next to each layer (0 = off). Off by default.
    retrieval_k: int = 0
    #: The confirmed layers retrieval draws from (written by export_dataset.py, training venues only).
    example_bank: Path = ML_DIR / "data" / "dataset" / "example_bank.jsonl"
    #: The map-editor assistant: base model, and the fine-tuned one (used only when
    #: eval_assistant.py approved it and its template check is current).
    assistant_model: str = "qwen2.5:3b"
    assistant_finetuned_model: str = "yetnew-assistant"
    #: Worked examples shown to the BASE assistant model per request (0 = off), drawn
    #: from the generated training requests. Turn on only if eval_assistant.py --examples wins.
    assistant_examples: int = 0
    #: "menu" (one fixed example per kind of action) or "nearest" (the most similar requests).
    assistant_example_mode: str = "menu"
    assistant_bank: Path = ML_DIR / "data" / "assistant" / "train.jsonl"


def load_settings() -> Settings:
    mode = os.environ.get("YETNEW_MODEL", "auto").strip().lower()
    return Settings(
        ollama_url=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"),
        base_model=os.environ.get("YETNEW_BASE_MODEL", "qwen2.5:3b"),
        finetuned_model=os.environ.get("YETNEW_FT_MODEL", "yetnew-layers"),
        batch_size=max(1, _int("YETNEW_BATCH_SIZE", 15)),
        timeout=float(_int("YETNEW_OLLAMA_TIMEOUT", 600)),
        num_ctx=max(2048, _int("YETNEW_NUM_CTX", 8192)),
        model_mode=mode if mode in {"auto", "baseline", "finetuned"} else "auto",
        choice_file=Path(os.environ.get("YETNEW_MODEL_CHOICE_FILE", ML_DIR / "model_choice.json")),
        template_check_file=Path(os.environ.get("YETNEW_TEMPLATE_CHECK_FILE", ML_DIR / "template_check.json")),
        retrieval_k=max(0, min(8, _int("YETNEW_RETRIEVAL_K", 0))),
        example_bank=Path(os.environ.get("YETNEW_EXAMPLE_BANK", ML_DIR / "data" / "dataset" / "example_bank.jsonl")),
        assistant_model=os.environ.get("YETNEW_ASSISTANT_MODEL", os.environ.get("YETNEW_BASE_MODEL", "qwen2.5:3b")),
        assistant_finetuned_model=os.environ.get("YETNEW_ASSISTANT_FT_MODEL", "yetnew-assistant"),
        assistant_examples=max(0, min(8, _int("YETNEW_ASSISTANT_EXAMPLES", 0))),
        assistant_example_mode="nearest" if os.environ.get("YETNEW_ASSISTANT_EXAMPLE_MODE", "menu").strip().lower() == "nearest" else "menu",
        assistant_bank=Path(os.environ.get("YETNEW_ASSISTANT_BANK", ML_DIR / "data" / "assistant" / "train.jsonl")),
    )
