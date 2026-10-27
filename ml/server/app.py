"""The layer-labeling service the map editor calls.

    python -m server --port 8787                (from ml/, with the venv active)

Without YETNEW_REQUIRE_AUTH=1 the service is for this machine only: the
launcher refuses a non-loopback --host, and if started some other way (plain
uvicorn), requests from other machines are refused.

POST   /assistant   the map-editor assistant (same request/answer as api/map-assistant.ts), local model
POST   /jobs        multipart file=<a .dxf>  →  202 {id, status, queue_position}
GET    /jobs/{id}   status, progress (done/total) and, when done, the result:
                    per-layer labels + summaries and the review policy
DELETE /jobs/{id}   cancel (queued: at once; running: after the current batch)
GET    /health      is the service up, can it reach Ollama, which model, queue

Jobs belong to the user who created them (see server/jobs.py for the queue
limits, expiry and restart rules). Uploads are streamed into the job's own
folder under a fixed name (the client's filename is never used as a path),
checked for size and for actually being DXF, and deleted when the job ends.
Saving corrections is the editor's job (Supabase, with the user's RLS).
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
import zlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path, PurePath
from typing import Annotated, Any, Callable

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from yetnew_layers.assistant import ask as assistant_ask
from yetnew_layers.assistant import FINETUNED_SCHEMA
from yetnew_layers.assistant import ExampleBank as AssistantExampleBank
from yetnew_layers.assistant import choose_assistant_model
from yetnew_layers.assistant import request_text as assistant_request_text
from yetnew_layers.classify import classify_baseline, classify_finetuned, skip_empty
from yetnew_layers.config import ML_DIR, Settings, load_settings
from yetnew_layers.labels import ALWAYS_CONFIRM, CONFIRM_ALL_LAYERS, LABEL_SET, REVIEW_THRESHOLD
from yetnew_layers.models import choose_model, finetuned_approved, read_choice
from yetnew_layers.ollama import OllamaError, OllamaUnavailable, list_models
from yetnew_layers.prompt import PROMPT_VERSION
from yetnew_layers.retrieval import ExampleBank
from yetnew_layers.template_check import status as template_status
from yetnew_layers.summarize import SUMMARIZER_VERSION, DxfReadError, summarize_file

from .auth import AuthError, check_bearer, is_loopback, load_auth_settings
from .jobs import JobLimitError, JobSettings, JobStore, UserFacingError, Worker

MAX_UPLOAD_BYTES = int(float(os.environ.get("YETNEW_MAX_UPLOAD_MB", "300")) * 1024 * 1024)  # a converted DWG can be 100+ MB of DXF
CHUNK = 1024 * 1024
CORS_ORIGINS = [o.strip() for o in os.environ.get("YETNEW_CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080").split(",") if o.strip()]

BINARY_DXF = b"AutoCAD Binary DXF\r\n\x1a\x00"
# An ASCII DXF opens with group code 0 and SECTION (optionally after 999 comments).
ASCII_DXF = re.compile(r"^\s*(?:999\s*\r?\n[^\n]*\r?\n\s*)*0\s*\r?\n\s*SECTION\b")


def job_settings() -> JobSettings:
    return JobSettings(
        db_path=Path(os.environ.get("YETNEW_JOBS_DB", ML_DIR / "data" / "jobs.sqlite")),
        upload_root=Path(os.environ.get("YETNEW_JOBS_DIR", Path(tempfile.gettempdir()) / "yetnew-jobs")),
        max_active=max(1, int(os.environ.get("YETNEW_MAX_JOBS", "4"))),
        ttl_seconds=max(60.0, float(os.environ.get("YETNEW_JOB_TTL_MIN", "60")) * 60),
    )


def load_bank(settings: Settings) -> ExampleBank | None:
    """The retrieval example bank, when retrieval is on (YETNEW_RETRIEVAL_K > 0) and the bank exists."""
    if settings.retrieval_k <= 0 or not settings.example_bank.exists():
        return None
    bank = ExampleBank.load(settings.example_bank)
    return bank if len(bank) else None


def drawing_shape(summaries: list[dict[str, Any]]) -> dict[str, Any]:
    """How the drawing uses layers. Drawings from the web, converters or traced images
    often keep (almost) everything on ONE layer; then layer labels can't separate walls
    from furniture, and the editor tells the person so in plain words."""
    used = [s for s in summaries if int(s.get("total", 0)) > 0]
    total = sum(int(s["total"]) for s in used)
    biggest = max(used, key=lambda s: int(s["total"]), default=None)
    share = round(int(biggest["total"]) / total, 3) if biggest and total else 0.0
    return {
        "layers_used": len(used),
        "entities": total,
        "largest_layer": str(biggest["name"]) if biggest else None,
        "largest_layer_share": share,
        "single_layer": total > 0 and (len(used) == 1 or share >= 0.9),
    }


KNOWN_FILE = "known.json"


def read_known(path: Path) -> dict[str, str]:
    """The layers the editor's rules were sure about, sent with the job (see create_job)."""
    try:
        data = json.loads((path.parent / KNOWN_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(data, dict) else {}


def label_file(path: Path, progress: Callable[[int, int], None]) -> dict[str, Any]:
    """One job's work: summarize the DXF, label every layer, return what the editor shows."""
    settings = load_settings()
    started = time.perf_counter()
    known = read_known(path)
    try:
        summaries = summarize_file(path)
        progress(0, sum(1 for s in summaries if int(s.get("total", 0) or 0) > 0 and str(s.get("name", "")) not in known))
        active = choose_model(settings)
        bank = load_bank(settings) if active.kind == "baseline" else None
        # Only layers that need the model go to it (skip_empty): not empty ones, not ones the
        # editor's rules were sure about. Progress counts those.
        if active.kind == "finetuned":
            results = skip_empty(summaries, lambda used: classify_finetuned(used, settings, model=active.name, on_progress=progress), known)
        else:
            results = skip_empty(summaries, lambda used: classify_baseline(used, settings, model=active.name, on_progress=progress,
                                                                           bank=bank, retrieval_k=settings.retrieval_k), known)
    except (DxfReadError, OllamaUnavailable, OllamaError, ValueError) as err:
        raise UserFacingError(str(err)) from err
    return {
        "model": active.to_dict(),
        "retrieval_examples": settings.retrieval_k if bank is not None else 0,
        "drawing": drawing_shape(summaries),
        "summarizer_version": SUMMARIZER_VERSION,
        "prompt_version": PROMPT_VERSION,
        "seconds": round(time.perf_counter() - started, 1),
        # The review gate, so the editor follows the one policy in labels.py.
        "review": {
            "confirm_all_layers": CONFIRM_ALL_LAYERS,
            "threshold": REVIEW_THRESHOLD,
            "always_confirm": sorted(ALWAYS_CONFIRM),
        },
        "layers": [{**r.to_dict(), "summary": s} for r, s in zip(results, summaries)],
    }


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    store = JobStore(job_settings())  # marks jobs left over from a previous run as failed
    app.state.jobs = store
    # Looked up on each run, so tests can replace label_file.
    app.state.worker = Worker(store, lambda path, progress: label_file(path, progress))
    try:
        yield
    finally:
        app.state.worker.stop()
        store.close()


app = FastAPI(title="Yet New layer labeling", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def local_only_without_auth(request: Request, call_next: Any) -> Response:
    """Without auth, only this machine may call the service (see the module docstring)."""
    client = request.client.host if request.client else ""
    if not is_loopback(client) and not load_auth_settings().required:
        return JSONResponse({"detail": "This service only accepts local requests unless YETNEW_REQUIRE_AUTH=1."}, status_code=403)
    response: Response = await call_next(request)
    return response


def looks_like_dxf(head: bytes) -> bool:
    if head.startswith(BINARY_DXF):
        return True
    text = head.decode("latin-1").lstrip("﻿\xef\xbb\xbf")
    return bool(ASCII_DXF.match(text))


def safe_name(filename: str | None) -> str:
    """The client's filename, for messages only: no directories, no control characters."""
    name = PurePath((filename or "").replace("\\", "/")).name
    return re.sub(r"[^\w.\- ()]", "_", name)[:120] or "upload.dxf"


async def save_upload(file: UploadFile, folder: Path) -> Path:
    """Streams the upload to <folder>/upload.dxf, enforcing the size limit as it goes.

    The editor gzips big drawings (a DWG's DXF text runs to 100 MB; gzipped about a tenth):
    recognised by the gzip magic bytes and unpacked on the way. The limit counts the
    unpacked size, so a small file can't expand into a huge one."""
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / "upload.dxf"
    size = 0
    unzip: zlib._Decompress | None = None
    first = True
    with target.open("wb") as out:
        while chunk := await file.read(CHUNK):
            if first:
                first = False
                if chunk[:2] == b"\x1f\x8b":
                    unzip = zlib.decompressobj(wbits=31)
            try:
                data = unzip.decompress(chunk, MAX_UPLOAD_BYTES + 1 - size) if unzip else chunk
            except zlib.error as err:
                raise HTTPException(400, "The compressed upload is damaged.") from err
            size += len(data)
            if size > MAX_UPLOAD_BYTES or (unzip and unzip.unconsumed_tail):
                raise HTTPException(413, f"The file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
            out.write(data)
    if size == 0:
        raise HTTPException(400, "The file is empty.")
    with target.open("rb") as f:
        if not looks_like_dxf(f.read(4096)):
            raise HTTPException(415, "This isn't a DXF file. Export the drawing as DXF (or import the DWG in the editor).")
    return target


def caller(authorization: str | None) -> str:
    try:
        return check_bearer(authorization, load_auth_settings())
    except AuthError as err:
        raise HTTPException(err.status, str(err)) from err


def runtime(request: Request) -> tuple[JobStore, Worker]:
    store: JobStore = request.app.state.jobs
    store.expire()
    return store, request.app.state.worker


@app.get("/health")
def health(request: Request) -> dict[str, Any]:
    settings = load_settings()
    store: JobStore = request.app.state.jobs
    out: dict[str, Any] = {
        "status": "ok",
        "summarizer_version": SUMMARIZER_VERSION,
        "prompt_version": PROMPT_VERSION,
        "base_model": settings.base_model,
        "finetuned_model": settings.finetuned_model,
        "finetuned_approved": finetuned_approved(settings, read_choice(settings)),
        "num_ctx": settings.num_ctx,
        "auth_required": load_auth_settings().required,
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
        "jobs": {**store.counts(), "max_active": store.settings.max_active},
    }
    try:
        names = list_models(settings.ollama_url)
    except (OllamaUnavailable, OllamaError) as err:
        out.update(status="degraded", ollama="unreachable", error=str(err))
        return out
    active = choose_model(settings, installed=lambda: names)
    checked, why = template_status(settings, settings.finetuned_model)
    out.update(ollama="ok", installed_models=names, active_model=active.to_dict(),
               base_model_installed=settings.base_model in names,
               finetuned_template_check={"current": checked, "detail": why or "passed on this Ollama version and model digest"},
               retrieval_examples=settings.retrieval_k)
    return out


def parse_known(raw: str | None) -> dict[str, str]:
    """Checks the optional `known` form field: at most 5,000 layers, labels from the fixed list."""
    if not raw:
        return {}
    if len(raw) > 500_000:
        raise HTTPException(413, "known is too large.")
    try:
        data = json.loads(raw)
    except ValueError as err:
        raise HTTPException(400, "known must be a JSON object {layer: label}.") from err
    if not isinstance(data, dict) or len(data) > 5000:
        raise HTTPException(400, "known must be a JSON object {layer: label} with at most 5,000 layers.")
    bad = [k for k, v in data.items() if not isinstance(k, str) or len(k) > 255 or v not in LABEL_SET or v == "unknown"]
    if bad:
        raise HTTPException(400, f"known has invalid entries: {bad[:3]}")
    return data


@app.post("/jobs", status_code=202)
async def create_job(
    request: Request,
    file: Annotated[UploadFile, File(description="A .dxf drawing")],
    known: Annotated[str | None, Form(description='{"layer": "label"} the editor\'s rules are sure about; not sent to the model')] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    owner = caller(authorization)
    name = safe_name(file.filename)
    if not name.lower().endswith(".dxf"):
        raise HTTPException(415, "Only .dxf files can be labeled.")
    known_labels = parse_known(known)
    store, worker = runtime(request)
    try:
        job_id = store.reserve(owner, name)
    except JobLimitError as err:
        raise HTTPException(429, str(err)) from err
    try:
        await save_upload(file, store.upload_dir(job_id))
        if known_labels:
            (store.upload_dir(job_id) / KNOWN_FILE).write_text(json.dumps(known_labels), encoding="utf-8")
    except BaseException:
        await run_in_threadpool(store.drop, job_id)  # rejected or interrupted: no job, no file
        raise
    worker.submit(job_id)
    job = store.get(job_id, owner)
    assert job is not None
    return job


@app.get("/jobs/{job_id}")
def get_job(request: Request, job_id: str, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    owner = caller(authorization)
    store, _ = runtime(request)
    job = store.get(job_id, owner)
    if job is None:
        raise HTTPException(404, "No such job (it may have expired).")
    return job


@app.delete("/jobs/{job_id}", status_code=202)
def cancel_job(request: Request, job_id: str, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    owner = caller(authorization)
    store, worker = runtime(request)
    if store.get(job_id, owner) is None:
        raise HTTPException(404, "No such job (it may have expired).")
    worker.cancel(job_id)
    job = store.get(job_id, owner)
    assert job is not None
    return job


# ── The free map-editor assistant ────────────────────────────────────────────
# Same request and answer as api/map-assistant.ts (Claude), answered by a local
# model in Ollama: {text, history, context} → {actions, reply}. The editor tries
# this first and falls back to the Claude route only if this isn't running.

MAX_ASSISTANT_BODY = 200_000
_banks: dict[str, AssistantExampleBank] = {}


def assistant_bank(settings: Settings) -> AssistantExampleBank | None:
    """The worked-example bank, when YETNEW_ASSISTANT_EXAMPLES > 0 and the file exists (loaded once)."""
    if settings.assistant_examples <= 0 or not settings.assistant_bank.exists():
        return None
    key = str(settings.assistant_bank)
    if key not in _banks:
        _banks[key] = AssistantExampleBank.load(settings.assistant_bank)
    return _banks[key]
_assistant_lock = threading.Lock()  # one answer at a time: a CPU model is slower in parallel


@app.post("/assistant")
async def assistant(request: Request, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    caller(authorization)
    raw = await request.body()
    if len(raw) > MAX_ASSISTANT_BODY:
        raise HTTPException(413, "The request is too large.")
    try:
        body = json.loads(raw or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError) as err:  # not JSON, or not UTF-8
        raise HTTPException(400, "Send JSON: {text, history, context}.") from err
    if not isinstance(body, dict) or not assistant_request_text(body):
        raise HTTPException(400, "text is required")
    settings = load_settings()

    def answer() -> dict[str, Any]:
        with _assistant_lock:
            model, why = choose_assistant_model(settings)
            started = time.perf_counter()
            # Worked examples help only the base model (the fine-tuned one learned them).
            bank = assistant_bank(settings) if model == settings.assistant_model else None
            out = assistant_ask(body, settings, model, bank=bank, examples_k=settings.assistant_examples if bank else 0,
                                examples_mode=settings.assistant_example_mode,
                                schema=FINETUNED_SCHEMA if model == settings.assistant_finetuned_model else True)
            return {**out, "model": {"name": model, "reason": why}, "seconds": round(time.perf_counter() - started, 1)}

    try:
        result = await run_in_threadpool(answer)
    except OllamaUnavailable as err:
        raise HTTPException(503, str(err)) from err
    except OllamaError as err:
        raise HTTPException(502, str(err)) from err
    return {"actions": result["actions"], "reply": result["reply"], "model": result["model"], "seconds": result["seconds"]}
