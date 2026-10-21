"""The record that a model's chat format was verified through Ollama.

scripts/check_template.py --model <name> writes it after a passing check.
It is tied to the Ollama version and the model's digest, so it goes stale —
and the fine-tuned model stops being used — after `ollama create` (new
digest) or an Ollama upgrade (new version), until the check is run again.

evaluate.py refuses to write model_choice.json without a current record, and
the service (models.choose_model) won't pick the fine-tuned model without one.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings
from .ollama import OllamaError, OllamaUnavailable, model_digest, server_version


def _read(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def record(settings: Settings, model: str, *, ollama_version: str, digest: str, passed: bool) -> dict[str, Any]:
    entry = {"ollama_version": ollama_version, "digest": digest, "passed": passed,
             "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    data = _read(settings.template_check_file)
    data[model] = entry
    settings.template_check_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return entry


def status(settings: Settings, model: str, *, ollama_version: str | None = None, digest: str | None = None) -> tuple[bool, str]:
    """(verified?, why not). Asks Ollama for the live version and digest unless given."""
    entry = _read(settings.template_check_file).get(model)
    if not entry:
        return False, f"check_template.py --model {model} has not been run"
    if not entry.get("passed"):
        return False, f"check_template.py failed for {model}"
    try:
        version = ollama_version if ollama_version is not None else server_version(settings.ollama_url)
        current = digest if digest is not None else model_digest(settings.ollama_url, model)
    except (OllamaUnavailable, OllamaError) as err:
        return False, f"can't confirm the template check: {err}"
    if entry.get("ollama_version") != version:
        return False, f"Ollama changed ({entry.get('ollama_version')} → {version}): run check_template.py --model {model} again"
    if not current or entry.get("digest") != current:
        return False, f"{model} was re-created since the check: run check_template.py --model {model} again"
    return True, ""
