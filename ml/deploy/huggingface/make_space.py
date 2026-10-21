"""Write the folder to upload to a Hugging Face Docker Space (free CPU).

    python deploy/huggingface/make_space.py [--gguf ollama/yetnew-assistant.Q4_K_M.gguf] [--out deploy/huggingface/build]

It holds exactly what the service needs — code, instructions, the Modelfile,
the approved fine-tuned assistant (GGUF) and its approval — and nothing else:
no drawings, datasets, answers or local settings (ml/data stays home).

Refuses a smoke-test model, a GGUF without a current approval
(assistant_choice.json: the fine-tuned model won in eval_assistant.py for
this spec version), and a GGUF that isn't the one installed here as
`yetnew-assistant` — the approved one (a new download lands in the same
place before it is tested). The Space would otherwise serve an untested model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ML = HERE.parents[1]
sys.path.insert(0, str(ML))

from yetnew_layers.assistant import spec  # noqa: E402

CODE = ["pyproject.toml", "yetnew_layers", "server", "assistant", "templates", "scripts/check_template.py"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gguf", default=str(ML / "ollama" / "yetnew-assistant.Q4_K_M.gguf"))
    parser.add_argument("--out", default=str(HERE / "build"))
    args = parser.parse_args()
    gguf, out = Path(args.gguf), Path(args.out)

    if "smoke" in gguf.name.lower():
        print(f"{gguf.name} is a notebook smoke-test model — never deployed.", file=sys.stderr)
        return 2
    if not gguf.is_file() or gguf.read_bytes()[:4] != b"GGUF":
        print(f"{gguf} is not a GGUF model file.", file=sys.stderr)
        return 2
    choice_path = ML / "assistant_choice.json"
    choice = json.loads(choice_path.read_text(encoding="utf-8")) if choice_path.exists() else {}
    if not (choice.get("winner") == "finetuned" and choice.get("finetuned_model") == "yetnew-assistant"
            and choice.get("spec_version") == spec()["version"]):
        print("assistant_choice.json doesn't approve yetnew-assistant for this spec version — run eval_assistant.py --write first.", file=sys.stderr)
        return 2

    # The approved model is the one installed as yetnew-assistant: its GGUF layer is this file.
    digest = hashlib.sha256(gguf.read_bytes()).hexdigest()
    try:
        modelfile = subprocess.run(["ollama", "show", "yetnew-assistant", "--modelfile"], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        print("Couldn't ask Ollama which model is installed as yetnew-assistant — start Ollama and try again.", file=sys.stderr)
        return 2
    installed = re.search(r"sha256[-:]([0-9a-f]{64})", modelfile)
    if not installed or installed.group(1) != digest:
        print(f"{gguf.name} ({digest[:12]}) is not the approved model installed as yetnew-assistant "
              f"({installed.group(1)[:12] if installed else 'unknown'}). Evaluate it first (eval_assistant.py --write).", file=sys.stderr)
        return 2

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info")
    for rel in CODE:
        src, dst = ML / rel, out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        (shutil.copytree(src, dst, ignore=ignore) if src.is_dir() else shutil.copy2(src, dst))
    (out / "ollama").mkdir()
    shutil.copy2(ML / "ollama" / "Modelfile.assistant", out / "ollama" / "Modelfile.assistant")
    shutil.copy2(gguf, out / "ollama" / "yetnew-assistant.Q4_K_M.gguf")
    shutil.copy2(choice_path, out / "assistant_choice.json")
    shutil.copy2(HERE / "Dockerfile", out / "Dockerfile")
    # Unix line endings: the script runs in Linux.
    (out / "start.sh").write_text((HERE / "start.sh").read_text(encoding="utf-8").replace("\r\n", "\n"), encoding="utf-8", newline="\n")
    shutil.copy2(HERE / "SPACE_README.md", out / "README.md")
    (out / ".gitattributes").write_text("*.gguf filter=lfs diff=lfs merge=lfs -text\n", encoding="utf-8", newline="\n")

    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file()) / 1e9
    print(f"Wrote {out} ({size:.2f} GB): assistant GGUF {digest[:12]}, approved at {choice['exact']['finetuned']:.1%} exact.")
    print("Next: upload this folder to your Space (see deploy/huggingface/GUIDE.md).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
