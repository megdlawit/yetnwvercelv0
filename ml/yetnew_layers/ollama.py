"""A thin client for the local Ollama REST API (no Ollama Python package:
its API changes more often than the REST endpoints do).

Endpoints used: POST /api/chat, GET /api/tags.
"""

from __future__ import annotations

from typing import Any

import httpx


class OllamaUnavailable(RuntimeError):
    """Ollama isn't running or can't be reached."""


class OllamaError(RuntimeError):
    """Ollama answered, but with an error (unknown model, bad request…)."""


def _unavailable(base_url: str, err: Exception) -> OllamaUnavailable:
    return OllamaUnavailable(
        f"Can't reach Ollama at {base_url} ({type(err).__name__}). "
        "Start it with `ollama serve` (or open the Ollama app) and check OLLAMA_URL."
    )


def list_models(base_url: str, *, timeout: float = 5.0) -> list[str]:
    """Names of the models installed in Ollama (e.g. "qwen2.5:7b", "yetnew-layers:latest")."""
    try:
        resp = httpx.get(f"{base_url.rstrip('/')}/api/tags", timeout=timeout)
    except httpx.HTTPError as err:
        raise _unavailable(base_url, err) from err
    if resp.status_code != 200:
        raise OllamaError(f"Ollama /api/tags returned {resp.status_code}: {resp.text[:200]}")
    return [m.get("name", "") for m in resp.json().get("models", [])]


def server_version(base_url: str, *, timeout: float = 5.0) -> str:
    """Ollama's version string (e.g. "0.40.2")."""
    try:
        resp = httpx.get(f"{base_url.rstrip('/')}/api/version", timeout=timeout)
    except httpx.HTTPError as err:
        raise _unavailable(base_url, err) from err
    if resp.status_code != 200:
        raise OllamaError(f"Ollama /api/version returned {resp.status_code}")
    return str(resp.json().get("version", ""))


def model_digest(base_url: str, model: str, *, timeout: float = 5.0) -> str | None:
    """The installed model's digest — it changes whenever the model is re-created. None if not installed."""
    try:
        resp = httpx.get(f"{base_url.rstrip('/')}/api/tags", timeout=timeout)
    except httpx.HTTPError as err:
        raise _unavailable(base_url, err) from err
    if resp.status_code != 200:
        raise OllamaError(f"Ollama /api/tags returned {resp.status_code}")
    wanted = {model, model if ":" in model else f"{model}:latest"}
    for m in resp.json().get("models", []):
        if m.get("name") in wanted:
            return str(m.get("digest") or "") or None
    return None


def has_model(base_url: str, model: str) -> bool:
    """True when `model` is installed (a bare name matches its :latest tag)."""
    names = set(list_models(base_url))
    return model in names or (":" not in model and f"{model}:latest" in names)


def chat(
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    format: str | dict[str, Any] | None = None,
    num_predict: int | None = None,
    num_ctx: int | None = None,
    logprobs: bool = False,
    top_logprobs: int | None = None,
    timeout: float = 300.0,
) -> dict[str, Any]:
    """One non-streaming chat call at temperature 0. Returns Ollama's response JSON."""
    options: dict[str, Any] = {"temperature": 0, "seed": 0}
    if num_predict is not None:
        options["num_predict"] = num_predict
    if num_ctx is not None:
        options["num_ctx"] = num_ctx
    body: dict[str, Any] = {"model": model, "messages": messages, "stream": False, "options": options}
    if format is not None:
        body["format"] = format
    if logprobs:
        body["logprobs"] = True
        if top_logprobs:
            body["top_logprobs"] = top_logprobs
    try:
        # Connecting gets a short limit of its own: a dead port should fail fast, not after `timeout`.
        resp = httpx.post(f"{base_url.rstrip('/')}/api/chat", json=body, timeout=httpx.Timeout(timeout, connect=5.0))
    except (httpx.ConnectError, httpx.ConnectTimeout) as err:
        # Checked first: on Windows a closed port shows up as a connect *timeout*.
        raise _unavailable(base_url, err) from err
    except httpx.TimeoutException as err:
        raise OllamaError(f"Ollama took longer than {timeout:.0f}s ({model}). Try a smaller batch or model.") from err
    except httpx.HTTPError as err:
        raise _unavailable(base_url, err) from err
    if resp.status_code == 404:
        raise OllamaError(f'Model "{model}" is not installed in Ollama. Run `ollama pull {model}`.')
    if resp.status_code != 200:
        raise OllamaError(f"Ollama returned {resp.status_code}: {resp.text[:300]}")
    return resp.json()
