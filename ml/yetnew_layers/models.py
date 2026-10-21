"""Which model labels layers right now.

The fine-tuned model is used only when BOTH are true:
  1. it is installed in Ollama, and
  2. scripts/evaluate.py approved it: on held-out venues it beat the baseline
     (model_choice.json says winner = "finetuned" for that model name), with
     the prompt it is about to get: same PROMPT_VERSION, same
     INCLUDE_TEXT_SAMPLES setting, and
  3. scripts/check_template.py passed for it on THIS Ollama version and
     model digest (re-run after every `ollama create` or Ollama upgrade).
Otherwise the baseline is used. YETNEW_MODEL=baseline|finetuned forces one
(finetuned still has to be installed).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any, Callable

from .config import Settings
from .ollama import list_models
from .prompt import INCLUDE_TEXT_SAMPLES, PROMPT_VERSION
from .template_check import status as template_status


@dataclass(frozen=True)
class ActiveModel:
    name: str
    kind: str  # "baseline" | "finetuned"
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def read_choice(settings: Settings) -> dict[str, Any] | None:
    """The last evaluation's verdict, or None if there's none (or it's unreadable)."""
    try:
        data = json.loads(settings.choice_file.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def finetuned_approved(settings: Settings, choice: dict[str, Any] | None) -> bool:
    """evaluate.py chose this fine-tuned model, for the prompt the service sends now."""
    return (
        bool(choice)
        and choice.get("winner") == "finetuned"
        and choice.get("finetuned_model") == settings.finetuned_model
        and choice.get("prompt_version") == PROMPT_VERSION
        and choice.get("include_text_samples") == INCLUDE_TEXT_SAMPLES
    )


def _installed(names: list[str], model: str) -> bool:
    return model in names or (":" not in model and f"{model}:latest" in names)


def choose_model(
    settings: Settings,
    installed: Callable[[], list[str]] | None = None,
    template_ok: Callable[[str], tuple[bool, str]] | None = None,
) -> ActiveModel:
    names = (installed or (lambda: list_models(settings.ollama_url)))()
    check = template_ok or (lambda model: template_status(settings, model))
    base = ActiveModel(settings.base_model, "baseline", "")
    if settings.model_mode == "baseline":
        return ActiveModel(base.name, base.kind, "forced by YETNEW_MODEL=baseline")
    ft_here = _installed(names, settings.finetuned_model)
    if "smoke" in settings.finetuned_model.lower():
        return ActiveModel(base.name, base.kind, f"{settings.finetuned_model} is a notebook smoke-test model and is never used")
    if settings.model_mode == "finetuned":
        if not ft_here:
            return ActiveModel(base.name, base.kind, f"YETNEW_MODEL=finetuned, but {settings.finetuned_model} is not installed")
        verified, why = check(settings.finetuned_model)
        if not verified:
            return ActiveModel(base.name, base.kind, f"YETNEW_MODEL=finetuned, but its template check is not current: {why}")
        return ActiveModel(settings.finetuned_model, "finetuned", "forced by YETNEW_MODEL=finetuned")
    if not ft_here:
        return ActiveModel(base.name, base.kind, f"{settings.finetuned_model} is not installed")
    if not finetuned_approved(settings, read_choice(settings)):
        return ActiveModel(base.name, base.kind, f"{settings.finetuned_model} is installed but has not beaten the baseline in evaluate.py "
                           "(with the current prompt version and text-sample setting)")
    verified, why = check(settings.finetuned_model)
    if not verified:
        return ActiveModel(base.name, base.kind, f"{settings.finetuned_model} is approved but its template check is not current: {why}")
    return ActiveModel(settings.finetuned_model, "finetuned", "installed, approved by evaluate.py, template check current")
