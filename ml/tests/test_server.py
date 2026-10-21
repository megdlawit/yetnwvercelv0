"""The service: jobs (ownership, limits, cancel, expiry, restart), file checks,
model choice, Ollama errors and auth. Ollama is faked."""

from __future__ import annotations

import io
import json
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from server import __main__ as launcher
from server import app as app_module
from server import auth
from server.jobs import RESTARTED, JobSettings, JobStore, Worker
from yetnew_layers.classify import LayerResult, answer_probability, classify_finetuned
from yetnew_layers.config import Settings
from yetnew_layers.models import choose_model
from yetnew_layers.ollama import OllamaUnavailable
from yetnew_layers.prompt import INCLUDE_TEXT_SAMPLES, PROMPT_VERSION

FIXTURE = Path(__file__).parent / "fixtures" / "SYNTHETIC_architect_plan.dxf"
LOCAL = ("127.0.0.1", 50000)


def settings(tmp_path: Path, mode: str = "auto") -> Settings:
    return Settings(ollama_url="http://ollama", base_model="base:3b", finetuned_model="yetnew-layers",
                    batch_size=10, timeout=5, model_mode=mode, choice_file=tmp_path / "model_choice.json",
                    template_check_file=tmp_path / "template_check.json")


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("YETNEW_REQUIRE_AUTH", "0")
    monkeypatch.setenv("YETNEW_JOBS_DB", str(tmp_path / "jobs.sqlite"))
    monkeypatch.setenv("YETNEW_JOBS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("YETNEW_MAX_JOBS", "2")


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app_module.app, client=LOCAL) as c:  # runs the lifespan: job store + worker
        yield c


@pytest.fixture
def fake_baseline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module, "choose_model", lambda s, installed=None: choose_model(s, installed=lambda: ["qwen2.5:3b"]))

    def fake(summaries: list[dict[str, Any]], s: Settings, *, model: str | None = None,
             on_progress: Callable[[int, int], None] | None = None, **_: Any) -> list[LayerResult]:
        if on_progress:
            on_progress(len(summaries), len(summaries))
        return [LayerResult(x["name"], "wall", 0.9, False) for x in summaries]

    monkeypatch.setattr(app_module, "classify_baseline", fake)


def submit(c: TestClient, data: bytes, name: str = "plan.dxf", token: str | None = None) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return c.post("/jobs", files={"file": (name, io.BytesIO(data), "application/dxf")}, headers=headers)


def wait(c: TestClient, job_id: str, token: str | None = None, until: tuple[str, ...] = ("done", "failed", "cancelled")) -> dict[str, Any]:
    """Waits on the job store's condition (woken by every change — no sleeps), then reads the job through the API."""
    store: JobStore = c.app.state.jobs  # type: ignore[attr-defined]
    store.wait_for(job_id, token or "local", until, timeout=30)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return c.get(f"/jobs/{job_id}", headers=headers).json()


def uploads(tmp_path: Path) -> list[Path]:
    root = tmp_path / "uploads"
    return list(root.rglob("*")) if root.exists() else []


# ── Jobs ─────────────────────────────────────────────────────────────────────

def test_job_runs_and_returns_every_layer(client: TestClient, fake_baseline: None, tmp_path: Path) -> None:
    resp = submit(client, FIXTURE.read_bytes())
    assert resp.status_code == 202, resp.text
    assert resp.json()["status"] in ("queued", "running", "done")
    job = wait(client, resp.json()["id"])
    assert job["status"] == "done", job
    assert (job["done"], job["total"]) == (18, 18)
    body = job["result"]
    assert body["model"]["kind"] == "baseline" and len(body["layers"]) == 18
    first = body["layers"][0]
    assert set(first) == {"name", "label", "confidence", "needs_review", "must_confirm", "source", "summary"}
    assert first["summary"]["name"] == first["name"]
    assert body["review"] == {"confirm_all_layers": True, "threshold": 0.7, "always_confirm": ["ignore", "unknown", "walkable"]}
    assert uploads(tmp_path) == []  # the upload is gone once the job ends


def test_rejected_uploads_leave_no_job_and_no_file(client: TestClient, fake_baseline: None, tmp_path: Path,
                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    assert submit(client, b"PK\x03\x04 zip bytes", "plan.dwg").status_code == 415
    assert submit(client, b"%PDF-1.7 not a drawing", "plan.dxf").status_code == 415
    assert submit(client, b"", "plan.dxf").status_code == 400
    monkeypatch.setattr(app_module, "MAX_UPLOAD_BYTES", 1024)
    assert submit(client, FIXTURE.read_bytes()).status_code == 413
    assert client.get("/health").json()["jobs"] == {"max_active": 2}
    assert uploads(tmp_path) == []


def test_unreadable_dxf_fails_the_job_with_the_reason(client: TestClient, fake_baseline: None) -> None:
    resp = submit(client, b"0\nSECTION\n2\nENTITIES\nxx\nLINE\n0\nENDSEC\n0\nEOF\n")  # passes the sniff, bad group code
    job = wait(client, resp.json()["id"])
    assert job["status"] == "failed" and "Invalid group code" in job["error"]


def test_ollama_down_fails_the_job_clearly(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def down(*a: Any, **k: Any) -> Any:
        raise OllamaUnavailable("Can't reach Ollama. Start it with `ollama serve`.")

    monkeypatch.setattr(app_module, "choose_model", down)
    job = wait(client, submit(client, FIXTURE.read_bytes()).json()["id"])
    assert job["status"] == "failed" and "ollama serve" in job["error"]


def test_filename_is_never_a_path(client: TestClient, fake_baseline: None, tmp_path: Path) -> None:
    resp = submit(client, FIXTURE.read_bytes(), "..\\..\\evil/../../plan.dxf")
    assert resp.json()["file_name"] == "plan.dxf"
    wait(client, resp.json()["id"])
    assert not (tmp_path / "evil").exists() and uploads(tmp_path) == []


@pytest.fixture
def blocking(monkeypatch: pytest.MonkeyPatch) -> Iterator[threading.Event]:
    """label_file that reports progress until released (or cancelled)."""
    release = threading.Event()

    def slow(path: Path, progress: Callable[[int, int], None]) -> dict[str, Any]:
        assert path.exists()  # the upload is there while the job runs
        for i in range(10_000):
            progress(i % 10, 10)  # raises JobCancelled once cancelled
            if release.wait(0.01):
                return {"layers": []}
        raise AssertionError("never released")

    monkeypatch.setattr(app_module, "label_file", slow)
    yield release
    release.set()


@pytest.fixture
def per_token_users(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auth where the bearer token IS the user id (the real check calls Supabase)."""
    monkeypatch.setattr(app_module, "check_bearer", lambda authorization, s: (authorization or "Bearer anon").split()[-1])


def test_jobs_belong_to_their_creator(client: TestClient, blocking: threading.Event, per_token_users: None) -> None:
    job_id = submit(client, FIXTURE.read_bytes(), token="alice").json()["id"]
    assert client.get(f"/jobs/{job_id}", headers={"Authorization": "Bearer alice"}).status_code == 200
    assert client.get(f"/jobs/{job_id}", headers={"Authorization": "Bearer bob"}).status_code == 404
    assert client.delete(f"/jobs/{job_id}", headers={"Authorization": "Bearer bob"}).status_code == 404
    assert client.get(f"/jobs/{job_id}", headers={"Authorization": "Bearer alice"}).json()["status"] != "cancelled"


def test_queue_limits_one_per_user_and_a_total(client: TestClient, blocking: threading.Event, per_token_users: None) -> None:
    a = submit(client, FIXTURE.read_bytes(), token="alice")
    assert a.status_code == 202
    again = submit(client, FIXTURE.read_bytes(), token="alice")
    assert again.status_code == 429 and "already have" in again.json()["detail"]
    b = submit(client, FIXTURE.read_bytes(), token="bob")
    assert b.status_code == 202 and b.json()["queue_position"] == 1
    full = submit(client, FIXTURE.read_bytes(), token="carol")  # YETNEW_MAX_JOBS=2
    assert full.status_code == 429 and "busy" in full.json()["detail"]
    blocking.set()
    assert wait(client, a.json()["id"], "alice")["status"] == "done"
    assert wait(client, b.json()["id"], "bob")["status"] == "done"
    assert submit(client, FIXTURE.read_bytes(), token="carol").status_code == 202  # room again


def test_cancel_running_and_queued_jobs(client: TestClient, blocking: threading.Event, per_token_users: None, tmp_path: Path) -> None:
    running = submit(client, FIXTURE.read_bytes(), token="alice").json()["id"]
    wait(client, running, "alice", until=("running",))
    queued = submit(client, FIXTURE.read_bytes(), token="bob").json()["id"]
    assert client.delete(f"/jobs/{queued}", headers={"Authorization": "Bearer bob"}).json()["status"] == "cancelled"
    client.delete(f"/jobs/{running}", headers={"Authorization": "Bearer alice"})
    assert wait(client, running, "alice")["status"] == "cancelled"
    assert uploads(tmp_path) == []


def test_finished_jobs_expire(tmp_path: Path) -> None:
    store = JobStore(JobSettings(tmp_path / "j.sqlite", tmp_path / "up", ttl_seconds=60))
    old, new = store.reserve("a", "a.dxf"), store.reserve("b", "b.dxf")
    store.set_status(old, "done", result="{}", finished_at=time.time() - 120)
    store.set_status(new, "done", result="{}")
    assert store.expire() == 1
    assert store.get(old, "a") is None and store.get(new, "b") is not None


def test_restart_marks_unfinished_jobs_failed_and_removes_uploads(tmp_path: Path) -> None:
    js = JobSettings(tmp_path / "j.sqlite", tmp_path / "up")
    store = JobStore(js)
    running, queued, done = (store.reserve(o, "x.dxf") for o in ("a", "b", "c"))
    store.set_status(running, "running")
    store.set_status(queued, "queued")
    store.set_status(done, "done", result=json.dumps({"layers": []}))
    store.upload_dir(running).mkdir()
    (store.upload_dir(running) / "upload.dxf").write_text("0\nSECTION\n")
    store.close()

    after = JobStore(js)  # the service starts again
    for job_id, owner in ((running, "a"), (queued, "b")):
        job = after.get(job_id, owner)
        assert job is not None and job["status"] == "failed" and job["error"] == RESTARTED
    assert after.get(done, "c")["status"] == "done"  # type: ignore[index]
    assert list((tmp_path / "up").iterdir()) == []


# ── Health, host guard, auth ─────────────────────────────────────────────────

def test_health_reports_degraded_when_ollama_is_down(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    body = client.get("/health").json()
    assert body["status"] == "degraded" and body["ollama"] == "unreachable"
    assert body["num_ctx"] == 8192


def test_without_auth_only_local_requests_are_served() -> None:
    with TestClient(app_module.app, client=("192.168.1.20", 50000)) as remote:
        assert remote.get("/health").status_code == 403
    with TestClient(app_module.app, client=("::1", 50000)) as local:
        assert local.get("/health").status_code == 200


def test_launcher_refuses_public_host_without_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    started: list[str] = []
    monkeypatch.setattr(launcher.uvicorn, "run", lambda app, host, port: started.append(host))
    assert launcher.main(["--host", "0.0.0.0"]) == 2
    assert launcher.main(["--host", "::"]) == 2
    assert launcher.main(["--host", "127.0.0.1"]) == 0
    monkeypatch.setenv("YETNEW_REQUIRE_AUTH", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    assert launcher.main(["--host", "0.0.0.0"]) == 0
    assert started == ["127.0.0.1", "0.0.0.0"]


def test_auth_required_rejects_missing_token(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YETNEW_REQUIRE_AUTH", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    assert submit(client, FIXTURE.read_bytes()).status_code == 401
    assert client.get("/jobs/whatever").status_code == 401


def test_auth_returns_the_supabase_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_get(url: str, **k: Any) -> httpx.Response:
        token = k["headers"]["Authorization"]
        calls.append(token)
        return httpx.Response(200, json={"id": "user-123"}) if token == "Bearer good" else httpx.Response(401)

    monkeypatch.setattr(httpx, "get", fake_get)
    s = auth.AuthSettings(required=True, supabase_url="https://x.supabase.co", anon_key="anon")
    assert auth.check_bearer("Bearer good", s) == "user-123"
    assert auth.check_bearer("Bearer good", s) == "user-123"  # cached
    with pytest.raises(auth.AuthError) as err:
        auth.check_bearer("Bearer expired-token", s)
    assert err.value.status == 401 and calls == ["Bearer good", "Bearer expired-token"]
    assert auth.check_bearer(None, auth.AuthSettings(required=False, supabase_url="", anon_key="")) == auth.LOCAL_USER


# ── Model choice ─────────────────────────────────────────────────────────────

def test_baseline_when_finetuned_not_installed(tmp_path: Path) -> None:
    assert choose_model(settings(tmp_path), installed=lambda: ["base:3b"]).kind == "baseline"


def test_finetuned_installed_but_not_approved_stays_baseline(tmp_path: Path) -> None:
    active = choose_model(settings(tmp_path), installed=lambda: ["base:3b", "yetnew-layers:latest"])
    assert active.kind == "baseline" and "has not beaten" in active.reason


def choice(**over: Any) -> str:
    return json.dumps({"winner": "finetuned", "finetuned_model": "yetnew-layers", "prompt_version": PROMPT_VERSION,
                       "include_text_samples": INCLUDE_TEXT_SAMPLES, **over})


CHECKED = lambda model: (True, "")  # noqa: E731 — a current, passing template check


def test_finetuned_used_only_when_installed_and_it_won(tmp_path: Path) -> None:
    s = settings(tmp_path)
    s.choice_file.write_text(choice())
    assert choose_model(s, installed=lambda: ["yetnew-layers:latest"], template_ok=CHECKED).kind == "finetuned"
    s.choice_file.write_text(choice(winner="baseline"))
    assert choose_model(s, installed=lambda: ["yetnew-layers:latest"], template_ok=CHECKED).kind == "baseline"


def test_finetuned_needs_a_current_template_check(tmp_path: Path) -> None:
    from yetnew_layers.template_check import record, status

    s = settings(tmp_path)
    s.choice_file.write_text(choice())
    live = {"ollama_version": "0.40.2", "digest": "abc123"}

    def chosen() -> str:
        return choose_model(s, installed=lambda: ["yetnew-layers:latest"], template_ok=lambda m: status(s, m, **live)).kind

    assert chosen() == "baseline"                                         # never checked
    assert "has not been run" in status(s, "yetnew-layers", **live)[1]
    record(s, "yetnew-layers", ollama_version="0.40.2", digest="abc123", passed=False)
    assert chosen() == "baseline"                                         # check failed
    record(s, "yetnew-layers", ollama_version="0.40.2", digest="abc123", passed=True)
    assert chosen() == "finetuned"
    live["ollama_version"] = "0.41.0"                                     # Ollama upgraded
    assert chosen() == "baseline" and "Ollama changed" in status(s, "yetnew-layers", **live)[1]
    live.update(ollama_version="0.40.2", digest="def456")                 # model re-created
    assert chosen() == "baseline" and "re-created" in status(s, "yetnew-layers", **live)[1]


def test_smoke_test_models_are_never_used(tmp_path: Path) -> None:
    s = Settings(ollama_url="http://ollama", base_model="base:3b", finetuned_model="SMOKE-TEST-delete-me",
                 batch_size=10, timeout=5, model_mode="finetuned", choice_file=tmp_path / "c.json")
    assert choose_model(s, installed=lambda: ["SMOKE-TEST-delete-me:latest"], template_ok=CHECKED).kind == "baseline"


def test_finetuned_not_used_with_a_different_prompt_than_it_was_evaluated_with(tmp_path: Path) -> None:
    s = settings(tmp_path)
    for stale in (choice(prompt_version=PROMPT_VERSION - 1), choice(include_text_samples=not INCLUDE_TEXT_SAMPLES), choice(prompt_version=None)):
        s.choice_file.write_text(stale)
        assert choose_model(s, installed=lambda: ["yetnew-layers:latest"]).kind == "baseline"


def test_forced_modes(tmp_path: Path) -> None:
    assert choose_model(settings(tmp_path, "baseline"), installed=lambda: ["yetnew-layers"]).kind == "baseline"
    assert choose_model(settings(tmp_path, "finetuned"), installed=lambda: ["yetnew-layers"], template_ok=CHECKED).kind == "finetuned"
    assert choose_model(settings(tmp_path, "finetuned"), installed=lambda: []).kind == "baseline"
    # Even forced, never without a current template check.
    assert choose_model(settings(tmp_path, "finetuned"), installed=lambda: ["yetnew-layers"],
                        template_ok=lambda m: (False, "not run")).kind == "baseline"


# ── Fine-tuned confidence ────────────────────────────────────────────────────

def test_answer_probability_sums_token_logprobs() -> None:
    assert answer_probability({"logprobs": [{"logprob": -0.1}, {"logprob": -0.2}]}) == pytest.approx(0.7408, abs=1e-4)
    assert answer_probability({}) is None


def test_finetuned_uses_logprobs_and_falls_back_to_disagreement(tmp_path: Path) -> None:
    layers = [{"name": n, "entity_counts": {}, "blocks": [], "texts": []} for n in ("A", "B", "C")]
    answers = {"A": ("wall", [-0.01]), "B": ("door", [-1.5]), "C": ("window", None)}

    def fake_chat(url: str, model: str, messages: list[dict[str, str]], **kw: Any) -> dict[str, Any]:
        assert kw["logprobs"] is True and model == "yetnew-layers" and kw["num_ctx"] == 8192
        name = json.loads(messages[1]["content"])["layer"]
        label, lps = answers[name]
        return {"message": {"content": label}, **({"logprobs": [{"logprob": x} for x in lps]} if lps else {})}

    baseline = lambda ss: [LayerResult(s["name"], "wall", 0.9, False) for s in ss]  # noqa: E731
    a, b, c = classify_finetuned(layers, settings(tmp_path), chat_fn=fake_chat, baseline_fn=baseline)
    assert (a.label, a.needs_review) == ("wall", False)
    assert (b.label, b.needs_review) == ("door", True)      # P = 0.22 < 0.7
    assert (c.confidence, c.needs_review) == (None, True)   # no log-probs, baseline says wall ≠ window


# ── Races between completion, cancel and restart (no sleeps: condition waits) ──

def store_and_worker(tmp_path: Path, run: Callable[[Path, Callable[[int, int], None]], dict[str, Any]]) -> tuple[JobStore, Worker, list[tuple[str, str]]]:
    store = JobStore(JobSettings(tmp_path / "j.sqlite", tmp_path / "up"))
    history: list[tuple[str, str]] = []
    real = store.transition

    def recording(job_id: str, from_states: tuple[str, ...], to: str, **fields: Any) -> bool:
        moved = real(job_id, from_states, to, **fields)
        if moved:
            history.append((job_id, to))
        return moved

    store.transition = recording  # type: ignore[method-assign]
    return store, Worker(store, run), history


def queue_job(store: JobStore, worker: Worker, owner: str) -> str:
    job_id = store.reserve(owner, "x.dxf")
    store.upload_dir(job_id).mkdir(parents=True)
    (store.upload_dir(job_id) / "upload.dxf").write_text("0\nSECTION\n")
    worker.submit(job_id)
    return job_id


def test_cancel_racing_the_start_never_corrupts_a_job(tmp_path: Path) -> None:
    """Cancel lands at every possible moment around the worker picking the job up."""
    def quick(path: Path, progress: Callable[[int, int], None]) -> dict[str, Any]:
        assert path.exists(), "a job ran without its upload"
        progress(1, 1)
        return {"layers": []}

    store, worker, history = store_and_worker(tmp_path, quick)
    try:
        for i in range(300):
            job_id = queue_job(store, worker, f"user-{i}")
            worker.cancel(job_id)
            job = store.wait_for(job_id, f"user-{i}", timeout=10)
            assert job is not None and job["status"] in ("cancelled", "done"), job
            assert not store.upload_dir(job_id).exists()
            states = [to for j, to in history if j == job_id]
            assert states[-1] == job["status"]
            assert sum(s in ("done", "failed", "cancelled") for s in states) == 1, states   # finished exactly once
            assert "failed" not in states
    finally:
        worker.stop()
        store.close()


def test_upload_is_gone_before_the_job_reads_as_finished(tmp_path: Path) -> None:
    seen: list[bool] = []
    store, worker, _ = store_and_worker(tmp_path, lambda path, progress: {"layers": []})
    real = store.transition

    def check(job_id: str, from_states: tuple[str, ...], to: str, **fields: Any) -> bool:
        if to in ("done", "failed", "cancelled"):
            seen.append(store.upload_dir(job_id).exists())
        return real(job_id, from_states, to, **fields)

    store.transition = check  # type: ignore[method-assign]
    try:
        for i in range(50):
            job_id = queue_job(store, worker, f"u{i}")
            assert store.wait_for(job_id, f"u{i}")["status"] == "done"  # type: ignore[index]
        assert seen and not any(seen)
    finally:
        worker.stop()
        store.close()


def test_cancel_while_running_ends_cancelled_not_done(tmp_path: Path) -> None:
    started, finish = threading.Event(), threading.Event()

    def slow(path: Path, progress: Callable[[int, int], None]) -> dict[str, Any]:
        started.set()
        finish.wait(10)
        progress(1, 1)          # the cancel is noticed here
        return {"layers": []}

    store, worker, history = store_and_worker(tmp_path, slow)
    try:
        job_id = queue_job(store, worker, "a")
        assert started.wait(10)
        worker.cancel(job_id)
        finish.set()
        assert store.wait_for(job_id, "a")["status"] == "cancelled"  # type: ignore[index]
        assert [to for j, to in history if j == job_id] == ["queued", "running", "cancelled"]
    finally:
        worker.stop()
        store.close()


def test_shutdown_cancels_the_running_job_and_restart_fails_the_rest(tmp_path: Path) -> None:
    started = threading.Event()

    def forever(path: Path, progress: Callable[[int, int], None]) -> dict[str, Any]:
        started.set()
        while True:
            progress(0, 1)      # raises once shutdown cancels the job
            started.wait(0.01)

    settings = JobSettings(tmp_path / "j.sqlite", tmp_path / "up")
    store = JobStore(settings)
    worker = Worker(store, forever)
    running = queue_job(store, worker, "a")
    waiting = queue_job(store, worker, "b")
    assert started.wait(10)
    worker.stop(timeout=10)                       # clean shutdown: returns promptly
    assert not worker._thread.is_alive()
    assert store.status(running) == "cancelled"
    store.close()
    store.transition(waiting, ("queued",), "running")   # writes after close are ignored, not errors

    after = JobStore(settings)                    # next start: what never finished is failed
    assert after.get(waiting, "b")["status"] == "failed"  # type: ignore[index]
    assert after.get(running, "a")["status"] == "cancelled"  # type: ignore[index]
    assert list((tmp_path / "up").iterdir()) == []
    after.close()


def test_queue_position_follows_insertion_order_even_with_equal_timestamps(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import server.jobs as jobs_module

    monkeypatch.setattr(jobs_module.time, "time", lambda: 1_700_000_000.0)   # every job created "at the same time"
    store = JobStore(JobSettings(tmp_path / "j.sqlite", tmp_path / "up"))
    ids = [store.reserve(f"u{i}", "x.dxf") for i in range(3)]
    for job_id in ids:
        store.transition(job_id, ("receiving",), "queued")
    assert [store.get(j, f"u{i}")["queue_position"] for i, j in enumerate(ids)] == [0, 1, 2]  # type: ignore[index]
    store.close()


def test_drawing_shape_spots_single_layer_drawings() -> None:
    one = [{"name": "freecads.com", "total": 8135}, {"name": "0", "total": 0}, {"name": "Defpoints", "total": 0}]
    assert app_module.drawing_shape(one) == {"layers_used": 1, "entities": 8135, "largest_layer": "freecads.com",
                                             "largest_layer_share": 1.0, "single_layer": True}
    mostly = [{"name": "0", "total": 950}, {"name": "TXT", "total": 50}]
    assert app_module.drawing_shape(mostly)["single_layer"] is True
    layered = [{"name": "A-WALL", "total": 500}, {"name": "A-DOOR", "total": 300}, {"name": "A-FURN", "total": 200}]
    assert app_module.drawing_shape(layered)["single_layer"] is False
    assert app_module.drawing_shape([])["single_layer"] is False


# ── /assistant ───────────────────────────────────────────────────────────────

def test_assistant_answers_like_the_claude_route(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[dict[str, Any]] = []
    monkeypatch.setattr(app_module, "choose_assistant_model", lambda s: ("qwen2.5:3b", "base"))

    def fake(body: dict[str, Any], s: Settings, model: str, **kw: Any) -> dict[str, Any]:
        seen.append(body)
        return {"actions": [{"op": "connect", "from": "Cafe", "to": "Lobby"}], "reply": None, "valid": True}

    monkeypatch.setattr(app_module, "assistant_ask", fake)
    body = {"text": "connect cafe to lobby", "history": [], "context": {"floor": "G", "places": ["Cafe", "Lobby"]}}
    r = client.post("/assistant", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["actions"] == [{"op": "connect", "from": "Cafe", "to": "Lobby"}] and r.json()["reply"] is None
    assert r.json()["model"]["name"] == "qwen2.5:3b" and seen == [body]


def test_fine_tuned_assistant_is_asked_in_its_approved_mode(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from yetnew_layers.assistant import FINETUNED_SCHEMA

    seen: list[bool] = []

    def fake(body: dict[str, Any], s: Settings, model: str, **kw: Any) -> dict[str, Any]:
        seen.append(kw["schema"])
        return {"actions": [{"op": "undo"}], "reply": None, "valid": True}

    monkeypatch.setattr(app_module, "assistant_ask", fake)
    for model in ("yetnew-assistant", "qwen2.5:3b"):
        monkeypatch.setattr(app_module, "choose_assistant_model", lambda s, m=model: (m, "test"))
        assert client.post("/assistant", json={"text": "undo"}).status_code == 200
    assert seen == [FINETUNED_SCHEMA, True]                                 # the base model always gets the schema


def test_assistant_rejects_bad_requests(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.post("/assistant", json={"text": "   "}).status_code == 400
    assert client.post("/assistant", content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert client.post("/assistant", content='{"text": "café — x"}'.encode("cp1252"),           # not UTF-8
                       headers={"Content-Type": "application/json"}).status_code == 400
    assert client.post("/assistant", content=b"x" * 200_001).status_code == 413

    def down(*a: Any, **k: Any) -> Any:
        raise OllamaUnavailable("Start it with `ollama serve`.")

    monkeypatch.setattr(app_module, "choose_assistant_model", down)
    r = client.post("/assistant", json={"text": "undo"})
    assert r.status_code == 503 and "ollama serve" in r.json()["detail"]


def test_assistant_needs_a_session_when_auth_is_on(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YETNEW_REQUIRE_AUTH", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    assert client.post("/assistant", json={"text": "undo"}).status_code == 401


def test_fine_tuned_assistant_only_when_installed_approved_and_checked(tmp_path: Path) -> None:
    from yetnew_layers.assistant import FINETUNED_SCHEMA, choose_assistant_model, spec

    s = Settings(ollama_url="x", base_model="qwen2.5:3b", finetuned_model="ft", batch_size=1, timeout=1)
    choice = tmp_path / "assistant_choice.json"
    ok = lambda m: (True, "")  # noqa: E731

    def pick(**kw: Any) -> str:
        return choose_assistant_model(s, installed=kw.get("installed", lambda: ["yetnew-assistant:latest"]),
                                      template_ok=kw.get("template_ok", ok), choice_file=choice)[0]

    assert pick(installed=lambda: []) == "qwen2.5:3b"                       # not installed
    assert pick() == "qwen2.5:3b"                                           # never evaluated
    approved = {"winner": "finetuned", "finetuned_model": "yetnew-assistant", "spec_version": spec()["version"],
                "finetuned_schema": FINETUNED_SCHEMA}
    choice.write_text(json.dumps(approved))
    assert pick() == "yetnew-assistant"
    choice.write_text(json.dumps({**approved, "finetuned_schema": not FINETUNED_SCHEMA}))
    assert pick() == "qwen2.5:3b"                                           # approved in another answer mode
    choice.write_text(json.dumps({k: v for k, v in approved.items() if k != "finetuned_schema"}))
    assert pick() == ("yetnew-assistant" if FINETUNED_SCHEMA else "qwen2.5:3b")  # older file: measured with the schema
    choice.write_text(json.dumps(approved))
    assert pick(template_ok=lambda m: (False, "Ollama changed")) == "qwen2.5:3b"
    choice.write_text(json.dumps({"winner": "finetuned", "finetuned_model": "yetnew-assistant", "spec_version": -1}))
    assert pick() == "qwen2.5:3b"                                           # evaluated against an older spec


def test_jobs_take_the_layers_the_rules_are_sure_about() -> None:
    from fastapi import HTTPException

    from server.app import parse_known

    assert parse_known(None) == {} and parse_known('{"A-DOOR": "door"}') == {"A-DOOR": "door"}
    for bad in ('[1]', '{"A": "walls"}', '{"A": "unknown"}', "not json"):
        with pytest.raises(HTTPException) as err:
            parse_known(bad)
        assert err.value.status_code == 400


def test_read_known_tolerates_a_missing_or_broken_file(tmp_path: Path) -> None:
    from server.app import KNOWN_FILE, read_known

    dxf = tmp_path / "a.dxf"
    assert read_known(dxf) == {}
    (tmp_path / KNOWN_FILE).write_text('{"A-DOOR": "door", "x": 1}', encoding="utf-8")
    assert read_known(dxf) == {"A-DOOR": "door"}
    (tmp_path / KNOWN_FILE).write_text("{broken", encoding="utf-8")
    assert read_known(dxf) == {}
