"""The chat text the fine-tuned model is trained on, and the checks that Ollama
renders the same text at inference.

Three renderings of the same messages must agree:
  1. Hugging Face: Qwen2.5-Instruct's own chat template (vendored in
     templates/qwen2.5-instruct.chat_template.jinja, fetched 2026-10-10 from
     huggingface.co/Qwen/Qwen2.5-3B-Instruct; identical to the one in
     unsloth/Qwen2.5-3B-Instruct-bnb-4bit). The notebook trains on this.
  2. expected(): the format written out by hand.
  3. The TEMPLATE in ollama/Modelfile, rendered by render_go_template — a tiny
     interpreter for exactly the Go-template constructs that file uses. Any
     other construct raises, so the check can't silently pass.
Live, scripts/check_template.py compares what Ollama really sends the model
(via its answer, prompt token count and log-probs) with the Hugging Face text.
Note: Ollama 0.40.2 uses the GGUF's embedded template, not the Modelfile's
TEMPLATE, so for the fine-tuned model that live check is the one that counts.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

ML_DIR = Path(__file__).resolve().parents[1]
HF_TEMPLATE = ML_DIR / "templates" / "qwen2.5-instruct.chat_template.jinja"
MODELFILE = ML_DIR / "ollama" / "Modelfile"


def expected(messages: list[dict[str, str]], add_generation_prompt: bool) -> str:
    """Qwen2.5 ChatML, as trained: one block per message, then the assistant cue."""
    text = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages)
    return text + ("<|im_start|>assistant\n" if add_generation_prompt else "")


def render_hf(messages: list[dict[str, str]], add_generation_prompt: bool) -> str:
    """Renders the vendored Hugging Face template the way transformers does (sandboxed Jinja2)."""
    from jinja2.sandbox import ImmutableSandboxedEnvironment

    def raise_exception(message: str) -> None:
        raise ValueError(message)

    env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)
    env.globals["raise_exception"] = raise_exception
    template = env.from_string(HF_TEMPLATE.read_text(encoding="utf-8"))
    return template.render(messages=messages, add_generation_prompt=add_generation_prompt, tools=None)


def modelfile_template(path: Path = MODELFILE) -> str:
    text = path.read_text(encoding="utf-8")
    m = re.search(r'^TEMPLATE """(.*?)"""', text, re.S | re.M)
    if not m:
        raise ValueError(f"No TEMPLATE in {path}")
    return m.group(1)


# ── A tiny Go text/template interpreter (only what the Modelfile uses) ───────

_ACTION = re.compile(r"\{\{(-?)\s*(.*?)\s*(-?)\}\}", re.S)


def _tokens(template: str) -> list[tuple[str, str]]:
    """[("text", …) | ("action", …)] with Go's {{- / -}} whitespace trimming applied."""
    out: list[tuple[str, str]] = []
    pos = 0
    trim_next = False
    for m in _ACTION.finditer(template):
        text = template[pos:m.start()]
        if trim_next:
            text = text.lstrip()
        if m.group(1):
            text = text.rstrip()
        out.append(("text", text))
        out.append(("action", m.group(2)))
        trim_next = bool(m.group(3))
        pos = m.end()
    tail = template[pos:]
    out.append(("text", tail.lstrip() if trim_next else tail))
    return out


def _parse(tokens: list[tuple[str, str]], i: int = 0, stop: tuple[str, ...] = ()) -> tuple[list[Any], int, str]:
    nodes: list[Any] = []
    while i < len(tokens):
        kind, value = tokens[i]
        if kind == "text":
            nodes.append(("text", value))
            i += 1
            continue
        word = value.split(" ", 1)[0]
        if value in stop or word in stop or (value.startswith("else") and "else" in stop):
            return nodes, i, value
        if word == "if":
            branches: list[tuple[str, list[Any]]] = []
            cond = value[3:]
            while True:
                body, i, ended = _parse(tokens, i + 1, ("end", "else"))
                branches.append((cond, body))
                if ended == "end":
                    break
                cond = ended[8:] if ended.startswith("else if ") else "true"
            nodes.append(("if", branches))
            i += 1
        elif value == "range .Messages":
            body, i, _ = _parse(tokens, i + 1, ("end",))
            nodes.append(("range", body))
            i += 1
        elif re.fullmatch(r"\.(System|Content|Role)", value):
            nodes.append(("var", value[1:]))
            i += 1
        else:
            raise ValueError(f"render_go_template doesn't support {{{{ {value} }}}} — extend the check before using it")
    return nodes, i, ""


def _cond(cond: str, ctx: dict[str, Any]) -> bool:
    if cond == "true":
        return True
    if re.fullmatch(r"\.(System)", cond):
        return bool(ctx.get(cond[1:]))
    m = re.fullmatch(r'eq \.Role "(\w+)"', cond)
    if m:
        return ctx.get("Role") == m.group(1)
    raise ValueError(f"render_go_template doesn't support the condition {cond!r}")


def _render(nodes: list[Any], ctx: dict[str, Any], messages: list[dict[str, str]]) -> str:
    out = []
    for node in nodes:
        if node[0] == "text":
            out.append(node[1])
        elif node[0] == "var":
            out.append(str(ctx.get(node[1], "")))
        elif node[0] == "if":
            for cond, body in node[1]:
                if _cond(cond, ctx):
                    out.append(_render(body, ctx, messages))
                    break
        elif node[0] == "range":
            for m in messages:
                out.append(_render(node[1], {"Role": m["role"], "Content": m["content"]}, messages))
    return "".join(out)


def render_go_template(template: str, messages: list[dict[str, str]]) -> str:
    """How Ollama fills the template for a chat: the system message as .System, the rest as .Messages."""
    nodes, _, _ = _parse(_tokens(template))
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    rest = [m for m in messages if m["role"] != "system"]
    return _render(nodes, {"System": system}, rest)
