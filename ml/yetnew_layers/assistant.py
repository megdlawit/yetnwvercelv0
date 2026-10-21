"""The free map-editor assistant: a local model (Ollama) behind the same
contract as api/map-assistant.ts (Claude).

The contract — instructions, actions, the user message — lives in
src/lib/assistant/assistantSpec.ts; assistant/spec.json and
assistant/messages_fixture.json are generated from it, and tests keep this
module equal to it (same message for the same request).

Differences, because the model is small and local:
  * Actions are compact: only the fields an action uses (Claude's schema makes
    every field explicit, null). The editor gets the same shape either way.
  * The map summary is trimmed from the end to fit the context window.
  * Everything the model returns is validated: unknown actions, fields or
    values are dropped, so the editor only ever sees well-formed actions.

Training rows (assistant_data.py) are built with assistant_messages() and
canonical_answer() — the same functions used at inference.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from .config import ML_DIR, Settings
from .ollama import chat
from .prompt import estimate_tokens

SPEC_FILE = ML_DIR / "assistant" / "spec.json"
#: Room left in the context window for the answer.
ANSWER_TOKENS = 600
#: The fine-tuned model answers without the structured-output schema. It learned the
#: exact answer format; constrained to the schema it picked wrong fields ("what" for
#: "kind", "to" for "near", "value": "on" for "on": true) and was ~4x slower
#: (measured 2026-10-19, Ollama 0.40.3). Its answers are still validated by
#: parse_answer. eval_assistant.py records this in assistant_choice.json, and the
#: service uses the fine-tuned model only in the mode it was approved in.
FINETUNED_SCHEMA = False


@lru_cache(maxsize=1)
def spec() -> dict[str, Any]:
    return json.loads(SPEC_FILE.read_text(encoding="utf-8"))


def _strings(x: Any, n: int) -> list[str]:
    return [v[:80] for v in x if isinstance(v, str)][:n] if isinstance(x, list) else []


def request_text(body: dict[str, Any]) -> str:
    """Same as requestText() in assistantSpec.ts."""
    text = body.get("text") if isinstance(body, dict) else None
    return ("" if text is None else str(text))[:600].strip()


def user_message(body: dict[str, Any], brief_limit: int = 24000) -> str:
    """The user message — identical to assistantUserMessage() in assistantSpec.ts (for brief_limit=24000)."""
    ctx = body.get("context") if isinstance(body, dict) else None
    ctx = ctx if isinstance(ctx, dict) else {}
    floor = ctx.get("floor")
    brief = ctx.get("brief")
    summary = "\n".join([
        f"Current floor: {('' if floor is None else str(floor))[:80] or 'unknown'}",
        f"All floors: {', '.join(_strings(ctx.get('floors'), 40)) or 'one floor'}",
        f'Selected ("this"): {ctx["selection"][:80] if isinstance(ctx.get("selection"), str) else "nothing"}',
        f'Just talked about ("it"): {ctx["last"][:80] if isinstance(ctx.get("last"), str) else "nothing"}',
        brief[:brief_limit] if isinstance(brief, str) and brief.strip()
        else f"Places on this floor: {', '.join(_strings(ctx.get('places'), 300)) or 'none yet'}",
    ])
    raw_history = body.get("history") if isinstance(body, dict) else None
    history = ""
    if isinstance(raw_history, list):
        turns = [h for h in raw_history[-10:] if isinstance(h, dict) and isinstance(h.get("text"), str)]
        history = "\n".join(f"{'Manager' if h.get('who') == 'me' else 'Assistant'}: {h['text'][:400]}" for h in turns)
    convo = f"Conversation so far:\n{history}\n\n" if history else ""
    return f"Map summary:\n{summary}\n\n{convo}They said: {request_text(body)}"


def fitted_user_message(body: dict[str, Any], num_ctx: int, reserved: int = 0) -> str:
    """user_message() with the map summary cut (from the end) so prompt + answer
    (+ `reserved` tokens, e.g. worked examples) fit num_ctx."""
    budget = num_ctx - estimate_tokens(spec()["system"]) - ANSWER_TOKENS - 64 - reserved
    limit = 24000
    message = user_message(body, limit)
    while estimate_tokens(message) > budget and limit > 400:
        limit = int(limit * 0.8)
        message = user_message(body, limit)
    return message


def example_turns(examples: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Worked examples as earlier chat turns: what someone said (with the places it
    names) and the right answer. Short on purpose — no map summaries."""
    turns: list[dict[str, str]] = []
    for ex in examples:
        names = sorted({str(a[f]) for a in ex["actions"] for f in ("from", "to", "a", "b", "target", "near")
                        if isinstance(a.get(f), str) and a[f] not in ("this", "it", "here", "walls", "all")})
        places = f"Places in that example's map: {', '.join(names)}\n" if names else ""
        turns.append({"role": "user", "content": f"Example request. {places}They said: {ex['text']}"})
        turns.append({"role": "assistant", "content": canonical_answer(ex["actions"], ex["reply"])})
    return turns


def assistant_messages(body: dict[str, Any], num_ctx: int = 8192, examples: list[dict[str, Any]] | None = None) -> list[dict[str, str]]:
    """The prompt the local model gets (and, without examples, is trained on).
    Examples go between the instructions and the request, so the instructions
    stay first and identical (Ollama reuses them from its prompt cache)."""
    turns = example_turns(examples) if examples else []
    reserved = sum(estimate_tokens(t["content"]) + 8 for t in turns)
    return [{"role": "system", "content": spec()["system"]}, *turns,
            {"role": "user", "content": fitted_user_message(body, num_ctx, reserved)}]


# ── Worked examples for the base model (optional: YETNEW_ASSISTANT_EXAMPLES) ──

def _text_features(text: str) -> set[str]:
    t = " ".join(text.lower().split())
    words = {f"w:{w}" for w in t.replace(",", " ").replace("?", " ").split() if len(w) > 1}
    padded = f" {t} "
    return words | {f"c:{padded[i:i + 3]}" for i in range(len(padded) - 2)}


class ExampleBank:
    """Requests with their right answers (the generated TRAINING set — never a test
    phrasing). nearest() picks the most similar, at most one per phrasing template."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = [{"text": r["body"]["text"], "actions": r["actions"], "reply": r["reply"], "template": r["template"],
                      "clean": bool(r.get("clean"))} for r in rows]
        self._features = [_text_features(r["text"]) for r in self.rows]

    @classmethod
    def load(cls, path: Path, limit: int = 5000) -> ExampleBank:
        rows = []
        with path.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
                if len(rows) >= limit:
                    break
        return cls(rows)

    def __len__(self) -> int:
        return len(self.rows)

    def templates(self) -> set[str]:
        return {r["template"] for r in self.rows}

    def menu(self) -> list[dict[str, Any]]:
        """One clean worked example per kind of action (and one question/clarification),
        the same for every request: the model always sees the whole range of right
        answers and can't be misled by a look-alike phrasing. Fixed, so Ollama keeps it
        in its prompt cache. Picks, per action, the shortest CLEAN request (no filler, no typo)."""
        best: dict[str, dict[str, Any]] = {}
        for r in self.rows:
            ops = [a["op"] for a in r["actions"]] or ["reply"]
            if len(ops) != 1 or not r["clean"]:
                continue
            text = r["text"]
            cur = best.get(ops[0])
            if cur is None or (len(text), text) < (len(cur["text"]), cur["text"]):
                best[ops[0]] = r
        return [best[op] for op in sorted(best)]

    def nearest(self, text: str, k: int) -> list[dict[str, Any]]:
        if k <= 0:
            return []
        q = _text_features(text)
        scored = sorted(((len(q & f) / ((len(q) * len(f)) ** 0.5 or 1), i) for i, f in enumerate(self._features)),
                        key=lambda si: (-si[0], si[1]))
        picked: list[dict[str, Any]] = []
        seen: set[str] = set()
        for score, i in scored:
            r = self.rows[i]
            if score <= 0 or r["template"] in seen:
                continue
            seen.add(r["template"])
            picked.append(r)
            if len(picked) == k:
                break
        return picked


@lru_cache(maxsize=1)
def local_schema() -> dict[str, Any]:
    """Compact structured-output schema: op first, then only the fields used (spec order)."""
    s = spec()
    enums = s["enums"]
    props: dict[str, Any] = {"op": {"type": "string", "enum": s["ops"]}}
    for f in s["fields"]:
        if f in s["number_fields"]:
            props[f] = {"type": "number"}
        elif f in s["boolean_fields"]:
            props[f] = {"type": "boolean"}
        elif f in ("side", "direction"):
            props[f] = {"type": "string", "enum": enums["direction"]}
        elif f in enums:
            props[f] = {"type": "string", "enum": enums[f]}
        else:
            props[f] = {"type": "string"}
    return {
        "type": "object",
        "properties": {
            "actions": {"type": "array", "items": {"type": "object", "properties": props, "required": ["op"]}},
            "reply": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        },
        "required": ["actions", "reply"],
    }


def clean_action(a: Any) -> dict[str, Any] | None:
    """A well-formed action in spec field order, or None. Unknown fields and bad values are dropped."""
    if not isinstance(a, dict) or a.get("op") not in spec()["ops"]:
        return None
    props = local_schema()["properties"]["actions"]["items"]["properties"]
    out: dict[str, Any] = {"op": a["op"]}
    for f in spec()["fields"]:
        v = a.get(f)
        if v is None:
            continue
        t = props[f]
        if t["type"] == "number":
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                continue
        elif t["type"] == "boolean":
            if not isinstance(v, bool):
                continue
        elif not isinstance(v, str) or not v.strip() or ("enum" in t and v not in t["enum"]):
            continue
        out[f] = v.strip() if isinstance(v, str) else v
    return out


def canonical_answer(actions: list[dict[str, Any]], reply: str | None) -> str:
    """The exact text the fine-tuned model is trained to produce (and the schema yields)."""
    cleaned = [c for c in (clean_action(a) for a in actions) if c]
    return json.dumps({"actions": cleaned, "reply": reply}, ensure_ascii=False)


def training_example(body: dict[str, Any], actions: list[dict[str, Any]], reply: str | None, num_ctx: int = 8192) -> dict[str, Any]:
    return {"messages": [*assistant_messages(body, num_ctx), {"role": "assistant", "content": canonical_answer(actions, reply)}]}


def parse_answer(content: str) -> tuple[list[dict[str, Any]], str | None, bool]:
    """(actions, reply, valid JSON?) from the model's answer."""
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return [], None, False
    if not isinstance(data, dict):
        return [], None, False
    actions = [c for c in (clean_action(a) for a in data.get("actions") or []) if c]
    reply = data.get("reply") if isinstance(data.get("reply"), str) and data["reply"].strip() else None
    return actions, reply, True


ChatFn = Callable[..., dict[str, Any]]


def ask(body: dict[str, Any], settings: Settings, model: str, *, chat_fn: ChatFn = chat,
        bank: ExampleBank | None = None, examples_k: int = 0, examples_mode: str = "menu",
        schema: bool = True) -> dict[str, Any]:
    """One request to the local assistant: {actions, reply, valid}. With a bank, worked
    examples go in the prompt (base model only): mode "menu" = one per kind of action
    (examples_k > 0 switches it on), mode "nearest" = the examples_k most similar requests.
    schema=False: no structured-output constraint (the fine-tuned model, FINETUNED_SCHEMA)."""
    examples = None
    if bank is not None and examples_k > 0:
        examples = bank.menu() if examples_mode == "menu" else bank.nearest(request_text(body), examples_k)
    resp = chat_fn(
        settings.ollama_url, model, assistant_messages(body, settings.num_ctx, examples),
        **({"format": local_schema()} if schema else {}),
        num_ctx=settings.num_ctx, num_predict=ANSWER_TOKENS, timeout=settings.timeout,
    )
    actions, reply, valid = parse_answer((resp.get("message") or {}).get("content", ""))
    return {"actions": actions, "reply": reply, "valid": valid}


# ── Which assistant model ────────────────────────────────────────────────────

ASSISTANT_CHOICE_FILE = ML_DIR / "assistant_choice.json"


def read_assistant_choice(path: Path = ASSISTANT_CHOICE_FILE) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def assistant_approved(settings: Settings, choice: dict[str, Any] | None) -> bool:
    return (bool(choice) and choice.get("winner") == "finetuned"
            and choice.get("finetuned_model") == settings.assistant_finetuned_model
            and choice.get("spec_version") == spec()["version"]
            # Approved in the answer mode the service uses (older files: measured with the schema).
            and choice.get("finetuned_schema", True) == FINETUNED_SCHEMA)


def choose_assistant_model(settings: Settings, installed: Callable[[], list[str]] | None = None,
                           template_ok: Callable[[str], tuple[bool, str]] | None = None,
                           choice_file: Path = ASSISTANT_CHOICE_FILE) -> tuple[str, str]:
    """(model, why). The fine-tuned assistant only when installed, approved by
    eval_assistant.py for this spec version, and its template check is current."""
    from .models import _installed
    from .ollama import list_models
    from .template_check import status

    ft, base = settings.assistant_finetuned_model, settings.assistant_model
    if "smoke" in ft.lower():
        return base, f"{ft} is a notebook smoke-test model and is never used"
    names = (installed or (lambda: list_models(settings.ollama_url)))()
    if not _installed(names, ft):
        return base, f"{ft} is not installed"
    if not assistant_approved(settings, read_assistant_choice(choice_file)):
        return base, f"{ft} has not beaten {base} in eval_assistant.py (for this spec version)"
    ok, why = (template_ok or (lambda m: status(settings, m)))(ft)
    if not ok:
        return base, f"{ft} template check is not current: {why}"
    return ft, "fine-tuned, approved by eval_assistant.py, template check current"
