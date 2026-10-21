"""Scoring the map-editor assistant on held-out phrasings, through Ollama.

Per request:
  * exact   — the whole action list is right (op and every field; names
              compared case-insensitively, numbers within 2%), in order;
  * ops     — the right kinds of actions, in order (fields may differ);
  * reply   — for questions and unclear requests: no actions and a reply
              (asking back is right; guessing an action is wrong);
  * valid   — the answer was well-formed JSON.

Switch rule (fine-tuned replaces the base model), like the layer labeler's:
  * exact-match accuracy at least WIN_MARGIN (5 points) higher, and
  * the 95% interval of the difference above 0 (bootstrap over whole
    phrasing templates — examples of one template aren't independent), and
  * no drop on asking-instead-of-acting ("reply"), on destructive actions
    (remove, disconnect, publish), or on undo — the safety net.
assistant_choice.json is only written with >= MIN_EXAMPLES test requests, a
current template check for the fine-tuned model, and the current spec version.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import defaultdict
from pathlib import Path
from dataclasses import asdict, dataclass, field
from typing import Any, Callable

from .evaluate import bootstrap_ci

WIN_MARGIN = 0.05
MIN_EXAMPLES = 200
NO_REGRESSION = ("reply", "remove", "disconnect", "publish", "undo")  # undo: the safety net must never get worse
NUMBER_TOLERANCE = 0.02


def _same_value(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= NUMBER_TOLERANCE * max(1.0, abs(b))
    if isinstance(a, str) and isinstance(b, str):
        return a.strip().lower() == b.strip().lower()
    return a == b


def same_action(got: dict[str, Any], want: dict[str, Any]) -> bool:
    keys = set(got) | set(want)
    return all(k in got and k in want and _same_value(got[k], want[k]) for k in keys)


@dataclass
class Case:
    template: str
    op: str
    text: str
    want_actions: list[dict[str, Any]]
    want_reply: bool
    got_actions: list[dict[str, Any]]
    got_reply: str | None
    valid: bool

    @property
    def exact(self) -> bool:
        if self.want_reply and not self.want_actions:
            return not self.got_actions and bool(self.got_reply)
        return len(self.got_actions) == len(self.want_actions) and all(same_action(g, w) for g, w in zip(self.got_actions, self.want_actions))

    @property
    def ops_right(self) -> bool:
        return [a.get("op") for a in self.got_actions] == [a.get("op") for a in self.want_actions] and (
            bool(self.got_reply) or not (self.want_reply and not self.want_actions))


@dataclass
class AssistantReport:
    model: str
    n: int
    exact: float
    ops: float
    valid: float
    per_op: dict[str, dict[str, float]]
    mistakes: list[dict[str, Any]]
    seconds: float
    hits: list[bool] = field(default_factory=list, repr=False)


class AnswerCache:
    """Answers saved as they arrive (one JSON line each), so a long CPU run that is
    interrupted resumes where it stopped. Answers are deterministic (temperature 0,
    fixed seed), so a saved one stands for a fresh one. Key = setup + request."""

    def __init__(self, path: Path | None) -> None:
        self.path = path
        self.answers: dict[str, dict[str, Any]] = {}
        if path and path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    self.answers[row["key"]] = row["answer"]

    @staticmethod
    def key(setup: str, body: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps([setup, body], sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def get(self, key: str) -> dict[str, Any] | None:
        return self.answers.get(key)

    def put(self, key: str, answer: dict[str, Any]) -> None:
        self.answers[key] = answer
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"key": key, "answer": answer}, ensure_ascii=False) + "\n")


def run_model(rows: list[dict[str, Any]], model: str, ask_fn: Callable[[dict[str, Any], str], dict[str, Any]],
              *, cache: AnswerCache | None = None, setup: str = "", progress: Callable[[str], None] | None = None) -> AssistantReport:
    """Asks every test request. `setup` names everything that changes answers besides
    the request (model, examples…) for the cache."""
    started = time.perf_counter()
    cases = []
    reused = 0
    for i, r in enumerate(rows, start=1):
        key = AnswerCache.key(setup or model, r["body"])
        out = cache.get(key) if cache else None
        if out is None:
            out = ask_fn(r["body"], model)
            if cache:
                cache.put(key, {"actions": out["actions"], "reply": out["reply"], "valid": out["valid"]})
        else:
            reused += 1
        cases.append(Case(r["template"], r["op"], r["body"]["text"], r["actions"], r["reply"] is not None,
                          out["actions"], out["reply"], out["valid"]))
        if progress:
            progress(f"{setup or model}: {i}/{len(rows)} ({reused} from saved answers)")
    return report(model, cases, time.perf_counter() - started)


def report(model: str, cases: list[Case], seconds: float = 0.0) -> AssistantReport:
    n = len(cases)
    by_op: dict[str, list[Case]] = defaultdict(list)
    for c in cases:
        by_op[c.op].append(c)
    return AssistantReport(
        model=model, n=n,
        exact=round(sum(c.exact for c in cases) / n, 4) if n else 0.0,
        ops=round(sum(c.ops_right for c in cases) / n, 4) if n else 0.0,
        valid=round(sum(c.valid for c in cases) / n, 4) if n else 0.0,
        per_op={op: {"n": len(cs), "exact": round(sum(c.exact for c in cs) / len(cs), 4)} for op, cs in sorted(by_op.items())},
        mistakes=[{"template": c.template, "text": c.text, "want": c.want_actions or "reply", "got": c.got_actions, "reply": c.got_reply}
                  for c in cases if not c.exact],
        seconds=round(seconds, 1), hits=[c.exact for c in cases],
    )


@dataclass
class AssistantDecision:
    winner: str
    can_write: bool
    difference: float
    ci: tuple[float, float]
    regressions: list[str]
    reasons: list[str]


def decide(rows: list[dict[str, Any]], base: AssistantReport, ft: AssistantReport, *, template: tuple[bool, str],
           synthetic_only: bool = True) -> AssistantDecision:
    clusters = [{"building_id": r["template"]} for r in rows]
    lo, hi = bootstrap_ci(clusters, ft.hits, base.hits)
    diff = round(ft.exact - base.exact, 4)
    regressions = [op for op in NO_REGRESSION
                   if op in base.per_op and ft.per_op.get(op, {"exact": 0.0})["exact"] < base.per_op[op]["exact"]]
    wins = diff >= WIN_MARGIN and lo > 0 and not regressions
    reasons = []
    if base.n < MIN_EXAMPLES:
        reasons.append(f"only {base.n} test requests; at least {MIN_EXAMPLES} needed")
    if not template[0]:
        reasons.append(f"template check not current: {template[1]}")
    if "smoke" in ft.model.lower():
        reasons.append("a notebook smoke-test model is never chosen")
    return AssistantDecision("finetuned" if wins else "base", not reasons, diff, (lo, hi), regressions, reasons)


def report_dict(r: AssistantReport) -> dict[str, Any]:
    return {k: v for k, v in asdict(r).items() if k != "hits"}
