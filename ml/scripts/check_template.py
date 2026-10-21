"""Live check, through Ollama, that a chat request gives the model exactly the
text it was trained on.

What Ollama renders is what counts — and Ollama 0.40.2 (checked 2026-10-10)
renders chats with the chat template embedded in the model's GGUF (the Hugging
Face Jinja template) and does NOT use a Modelfile TEMPLATE for this model
family: a garbage TEMPLATE gave the same prompt. Unsloth's GGUF export embeds
the tokenizer's template, i.e. the training format; ollama/Modelfile's
TEMPLATE (same format, unit-tested) is the fallback for Ollama versions that
use it. This script checks the real outcome either way:

  A. /api/chat to the model                 → whatever template Ollama applies
  B. /api/generate raw=true, same model     → the Hugging Face (training) text
  Same text ⇒ same answer, same prompt token count, same token log-probs.

REQUIRED after every `ollama create` and every Ollama upgrade: --model mode
records the result for this Ollama version and model digest
(template_check.json). Without a current passing record, evaluate.py won't
write model_choice.json and the service won't use the fine-tuned model.

Modes:
    python scripts/check_template.py --model yetnew-layers   # the installed fine-tuned model — run after `ollama create`
    python scripts/check_template.py                          # before training: a throwaway model FROM the base model
                                                              # with ollama/Modelfile's TEMPLATE, plus a control with a
                                                              # garbage TEMPLATE that shows whether TEMPLATE is used at all

On CPU the first evaluation of a prompt can differ in the third decimal from
later ones (prompt cache), so every prompt is evaluated once to warm up first.
Exit code 0 = the model gets the training text.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from yetnew_layers.chat_format import MODELFILE, render_hf  # noqa: E402
from yetnew_layers.config import load_settings  # noqa: E402
from yetnew_layers.ollama import chat, model_digest, server_version  # noqa: E402
from yetnew_layers.template_check import record  # noqa: E402
from yetnew_layers.prompt import layer_messages  # noqa: E402

CHECK_MODEL = "yetnew-layers-templatecheck"
CONTROL_MODEL = "yetnew-layers-templatecontrol"
LAYERS = [
    {"name": "A-FLOR-STRS", "entity_counts": {"LINE": 60, "TEXT": 4}, "blocks": [], "texts": ["UP"]},
    {"name": "L-PLNT", "entity_counts": {"INSERT": 40, "CIRCLE": 12}, "blocks": ["TREE-OAK"], "texts": []},
    {"name": "Layer 7", "entity_counts": {"LINE": 3}, "blocks": [], "texts": []},
]

View = tuple[str, list[float], Any]


def ollama_exe() -> str:
    for candidate in ("ollama", str(Path.home() / "AppData/Local/Programs/Ollama/ollama.exe")):
        try:
            subprocess.run([candidate, "--version"], capture_output=True, check=True)
            return candidate
        except (OSError, subprocess.CalledProcessError):
            continue
    raise SystemExit("ollama not found on PATH")


def create(exe: str, name: str, modelfile: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "Modelfile"
        path.write_text(modelfile, encoding="utf-8")
        subprocess.run([exe, "create", name, "-f", str(path)], check=True, capture_output=True)


def ask_chat(url: str, model: str, msgs: list[dict[str, str]], num_ctx: int) -> View:
    r = chat(url, model, msgs, num_predict=6, logprobs=True, num_ctx=num_ctx)
    return r["message"]["content"], [round(t["logprob"], 3) for t in r.get("logprobs") or []], r.get("prompt_eval_count")


def ask_raw(url: str, model: str, msgs: list[dict[str, str]], num_ctx: int) -> View:
    r = httpx.post(f"{url}/api/generate", json={
        "model": model, "prompt": render_hf(msgs, add_generation_prompt=True), "raw": True, "stream": False,
        "logprobs": True, "options": {"temperature": 0, "seed": 0, "num_predict": 6, "num_ctx": num_ctx},
    }, timeout=600).json()
    return r["response"], [round(t["logprob"], 3) for t in r.get("logprobs") or []], r.get("prompt_eval_count")


def compare(url: str, model: str, num_ctx: int, label: str) -> bool:
    ok = True
    for layer in LAYERS:
        msgs = layer_messages(layer)
        warm = [ask_chat(url, model, msgs, num_ctx), ask_raw(url, model, msgs, num_ctx)]
        a, b = ask_chat(url, model, msgs, num_ctx), ask_raw(url, model, msgs, num_ctx)
        counts = [w[2] for w in warm]
        same = a[:2] == b[:2] and a[1] != [] and counts[0] == counts[1]
        ok &= same
        print(f"  {'MATCH' if same else 'DIFFERENT':<9} {label:<9} {layer['name']:<12} chat={a[0]!r} {a[1]}  "
              f"training text={b[0]!r} {b[1]}  prompt tokens {counts}")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", help="Check this installed model (e.g. yetnew-layers) instead of a throwaway one.")
    parser.add_argument("--base", default=load_settings().base_model, help="Base model for the throwaway check.")
    parser.add_argument("--modelfile", default=str(MODELFILE), help="Modelfile whose TEMPLATE/PARAMETERs to use.")
    args = parser.parse_args()
    s = load_settings()

    if args.model:
        ok = compare(s.ollama_url, args.model, s.num_ctx, "model")
        version, digest = server_version(s.ollama_url), model_digest(s.ollama_url, args.model) or ""
        record(s, args.model, ollama_version=version, digest=digest, passed=ok)
        print(f"Recorded in {s.template_check_file.name}: {args.model} @ Ollama {version}, digest {digest[:12]} — {'passed' if ok else 'FAILED'}")
    else:
        exe = ollama_exe()
        text = Path(args.modelfile).read_text(encoding="utf-8")
        create(exe, CHECK_MODEL, re.sub(r"^FROM .*$", f"FROM {args.base}", text, count=1, flags=re.M))
        create(exe, CONTROL_MODEL, f'FROM {args.base}\nTEMPLATE """GARBAGE {{{{ .Prompt }}}}"""\n')
        try:
            ok = compare(s.ollama_url, CHECK_MODEL, s.num_ctx, "Modelfile")
            msgs = layer_messages(LAYERS[1])
            ask_chat(s.ollama_url, CONTROL_MODEL, msgs, s.num_ctx)
            control, ours = ask_chat(s.ollama_url, CONTROL_MODEL, msgs, s.num_ctx), ask_chat(s.ollama_url, CHECK_MODEL, msgs, s.num_ctx)
            if control[:2] == ours[:2] and control[2] == ours[2]:
                print("  NOTE: a garbage TEMPLATE gives the same prompt — this Ollama ignores the Modelfile TEMPLATE and uses "
                      "the model's embedded chat template. The fine-tuned GGUF embeds the training template; check it with --model.")
            else:
                print("  NOTE: this Ollama uses the Modelfile TEMPLATE (a garbage TEMPLATE changed the prompt).")
        finally:
            subprocess.run([exe, "rm", CHECK_MODEL, CONTROL_MODEL], capture_output=True)
    print("Template check passed: the model gets the training text." if ok else "Template check FAILED.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
