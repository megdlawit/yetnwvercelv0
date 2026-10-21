r"""Before a Colab run: check the notebooks' data on this machine (CPU), with the
real Qwen2.5 tokenizer and the notebook's pinned transformers — everything the
notebook does except the GPU cells.

    .venv\Scripts\python.exe -m pip install -e ".[notebook-check]"     # transformers 5.5.0, no torch
    .venv\Scripts\python.exe scripts\check_notebook_data.py

Needs data/assistant_dataset.zip and data/synthetic_dataset_SMOKE_ONLY.zip (the
files you upload to Colab). Checks every row: the tokenizer's chat format equals
the training/Ollama format, no example exceeds the notebook's MAX_SEQ_LENGTH,
answer-only masking keeps exactly the answer, and the text ends with the EOS token.
Downloads only the tokenizer files (a few MB), not the model.
"""
import ast
import json
import re
import sys
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")  # the Windows console would choke on "→"

from transformers import AutoTokenizer

ML = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
TOKENIZER = "unsloth/Qwen2.5-3B-Instruct-bnb-4bit"


def notebook_code(name: str) -> str:
    nb = json.loads((ML / "notebooks" / name).read_text(encoding="utf-8"))
    return "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")


def notebook_fn(src: str, fn: str):
    python = re.sub(r"^!(?:.*\\\n)*.*$", "", src, flags=re.M)
    node = next(n for n in ast.walk(ast.parse(python)) if isinstance(n, ast.FunctionDef) and n.name == fn)
    scope: dict = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), name, "exec"), scope)
    return scope[fn]


def setting(src: str, name: str) -> int:
    return int(re.search(rf"^{name} = (\d+)", src, re.M).group(1))


failed = False
tok = AutoTokenizer.from_pretrained(TOKENIZER)
print(f"tokenizer {TOKENIZER}: eos={tok.eos_token!r} pad={tok.pad_token!r}")
response_ids = tok("<|im_start|>assistant\n", add_special_tokens=False)["input_ids"]

for name, zip_name, train_file in (("train_map_assistant.ipynb", "assistant_dataset.zip", "train.jsonl"),
                                   ("train_yetnew_layers.ipynb", "synthetic_dataset_SMOKE_ONLY.zip", "train.jsonl")):
    src = notebook_code(name)
    expected = notebook_fn(src, "expected")
    max_len = setting(src, "MAX_SEQ_LENGTH")
    with zipfile.ZipFile(ML / "data" / zip_name) as z:
        folder = z.namelist()[0].split("/")[0]
        rows = [json.loads(line) for line in z.read(f"{folder}/{train_file}").decode("utf-8").splitlines() if line.strip()]
        other = "test.jsonl" if "assistant" in zip_name else "val.jsonl"
        rows += [json.loads(line) for line in z.read(f"{folder}/{other}").decode("utf-8").splitlines() if line.strip()]

    format_bad = longest = mask_bad = eos_missing = 0
    for r in rows:
        msgs = r["messages"]
        text = tok.apply_chat_template(msgs, tokenize=False)
        if text != expected(msgs, False) or tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True) != expected(msgs[:2], True):
            format_bad += 1
        train_text = text.removesuffix("\n")
        ids = tok(train_text, add_special_tokens=False)["input_ids"]
        longest = max(longest, len(ids))
        # What train_on_responses_only keeps: everything after the last "<|im_start|>assistant\n".
        starts = [i for i in range(len(ids) - len(response_ids) + 1) if ids[i:i + len(response_ids)] == response_ids]
        kept = tok.decode(ids[starts[-1] + len(response_ids):]) if starts else ""
        if kept != msgs[2]["content"] + "<|im_end|>":
            mask_bad += 1
        if not train_text.endswith(tok.eos_token):
            eos_missing += 1
    print(f"\n{name} ({zip_name}): {len(rows)} rows")
    print(f"  chat format = Ollama/training format: {len(rows) - format_bad}/{len(rows)}")
    print(f"  longest example: {longest} tokens (MAX_SEQ_LENGTH {max_len}) → {'OK' if longest <= max_len else 'TOO LONG'}")
    print(f"  answer-only masking keeps exactly the answer + <|im_end|>: {len(rows) - mask_bad}/{len(rows)}")
    print(f"  training text already ends with the EOS token (TRL won't append another): {len(rows) - eos_missing}/{len(rows)}")
    if format_bad or mask_bad or eos_missing or longest > max_len:
        failed = True
print("\nAll checks passed — safe to upload." if not failed else "\nFAILED — fix before training.")
sys.exit(1 if failed else 0)
