"""Labeling jobs: queued, run one at a time on a worker thread, polled by the editor.

Labeling takes minutes on a CPU, so the editor submits a job, gets its id at
once, and polls for progress ("15 of 49 layers").

Rules:
  * Every job belongs to the user who created it (their Supabase user id, or
    "local" when auth is off). Other users get 404 for it.
  * The queue is limited: at most `max_active` queued or running jobs in all,
    and one per user.
  * Finished jobs expire after `ttl_seconds` (results deleted with them).
  * The upload is deleted when the job ends — BEFORE its final status is
    written, so a job that reads as finished never still has its file.
  * Jobs live in SQLite, so after a restart every job that was queued or
    running is marked failed (and its upload removed) instead of vanishing.

Concurrency: every status change is a compare-and-set (UPDATE … WHERE status
IN (…)), so the request thread (cancel) and the worker (start, finish) can't
overwrite each other: a job is started only if still queued, cancelled
outright only if still queued, and finished only if still running. Queue
order is SQLite's rowid (insertion order), not a timestamp, which can tie.
"""

from __future__ import annotations

import json
import logging
import queue
import shutil
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("yetnew.jobs")

ACTIVE = ("queued", "running")
#: Also counts against the limits: a job whose upload is still arriving.
UNFINISHED = ("receiving", "queued", "running")
FINISHED = ("done", "failed", "cancelled")
RESTARTED = "The labeling service restarted before this job finished. Upload the file again."


class JobLimitError(Exception):
    """The queue is full, or this user already has a job."""


class JobCancelled(Exception):
    """Raised inside a running job when its owner cancelled it."""


class UserFacingError(Exception):
    """A job failure whose message is safe and useful to show (bad DXF, Ollama down…)."""


@dataclass(frozen=True)
class JobSettings:
    db_path: Path
    upload_root: Path
    max_active: int = 4
    ttl_seconds: float = 3600.0


def _in(states: tuple[str, ...]) -> str:
    return "(" + ", ".join(f"'{s}'" for s in states) + ")"


class JobStore:
    """Job rows in SQLite. Thread-safe: one connection, one lock, and a condition
    that is notified on every change (wait_for)."""

    def __init__(self, settings: JobSettings) -> None:
        self.settings = settings
        settings.db_path.parent.mkdir(parents=True, exist_ok=True)
        settings.upload_root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._changed = threading.Condition(self._lock)
        self._closed = False
        self._db = sqlite3.connect(settings.db_path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS jobs (
                 id TEXT PRIMARY KEY, owner TEXT NOT NULL, file_name TEXT NOT NULL,
                 status TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, total INTEGER,
                 error TEXT, result TEXT, created_at REAL NOT NULL, finished_at REAL)"""
        )
        self._recover()

    # ── lifecycle ────────────────────────────────────────────────────────────

    def _recover(self) -> None:
        """After a restart: unfinished jobs failed, leftover uploads removed."""
        with self._lock:
            self._db.execute(f"UPDATE jobs SET status='failed', error=?, finished_at=? WHERE status IN {_in(UNFINISHED)}",
                             (RESTARTED, time.time()))
        for child in self.settings.upload_root.iterdir():
            shutil.rmtree(child, ignore_errors=True)

    def upload_dir(self, job_id: str) -> Path:
        return self.settings.upload_root / job_id

    def remove_upload(self, job_id: str) -> None:
        shutil.rmtree(self.upload_dir(job_id), ignore_errors=True)

    def expire(self) -> int:
        """Deletes finished jobs older than the TTL. Returns how many."""
        cutoff = time.time() - self.settings.ttl_seconds
        with self._lock:
            if self._closed:
                return 0
            rows = self._db.execute(f"SELECT id FROM jobs WHERE status IN {_in(FINISHED)} AND finished_at < ?", (cutoff,)).fetchall()
            self._db.executemany("DELETE FROM jobs WHERE id = ?", [(r["id"],) for r in rows])
            self._changed.notify_all()
        for r in rows:
            self.remove_upload(r["id"])
        return len(rows)

    def close(self) -> None:
        """Further writes are ignored (an unfinished job is marked failed at the next start)."""
        with self._lock:
            self._closed = True
            self._db.close()
            self._changed.notify_all()

    # ── queue ────────────────────────────────────────────────────────────────

    def reserve(self, owner: str, file_name: str) -> str:
        """Checks the limits and creates a job row in state 'receiving'. Not yet queued."""
        with self._lock:
            active = self._db.execute(f"SELECT owner FROM jobs WHERE status IN {_in(UNFINISHED)}").fetchall()
            if any(r["owner"] == owner for r in active):
                raise JobLimitError("You already have a layer-labeling job running. Wait for it or cancel it first.")
            if len(active) >= self.settings.max_active:
                raise JobLimitError("The labeling service is busy. Try again in a few minutes.")
            job_id = uuid.uuid4().hex
            self._db.execute("INSERT INTO jobs (id, owner, file_name, status, created_at) VALUES (?, ?, ?, 'receiving', ?)",
                             (job_id, owner, file_name, time.time()))
            self._changed.notify_all()
        return job_id

    def drop(self, job_id: str) -> None:
        """Forgets a job whose upload was rejected."""
        with self._lock:
            if not self._closed:
                self._db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
                self._changed.notify_all()
        self.remove_upload(job_id)

    def transition(self, job_id: str, from_states: tuple[str, ...], to: str, **fields: Any) -> bool:
        """Moves the job to `to` only if it is in one of `from_states` (atomically). True if it moved."""
        cols = {"status": to, **fields}
        if to in FINISHED:
            cols.setdefault("finished_at", time.time())
        sets = ", ".join(f"{k} = ?" for k in cols)
        with self._lock:
            if self._closed:
                return False
            moved = self._db.execute(f"UPDATE jobs SET {sets} WHERE id = ? AND status IN {_in(from_states)}",
                                     (*cols.values(), job_id)).rowcount == 1
            if moved:
                self._changed.notify_all()
        return moved

    def set_status(self, job_id: str, status: str, **fields: Any) -> None:
        """Unconditional status write — for tests and recovery tooling; the worker uses transition()."""
        self.transition(job_id, (*UNFINISHED, *FINISHED), status, **fields)

    def progress(self, job_id: str, done: int, total: int) -> None:
        with self._lock:
            if self._closed:
                return
            self._db.execute("UPDATE jobs SET done = ?, total = ? WHERE id = ? AND status = 'running'", (done, total, job_id))
            self._changed.notify_all()

    def status(self, job_id: str) -> str | None:
        with self._lock:
            if self._closed:
                return None
            row = self._db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return row["status"] if row else None

    def _view(self, job_id: str, owner: str) -> dict[str, Any] | None:
        """The job as its owner sees it (lock held by the caller)."""
        row = self._db.execute("SELECT rowid AS seq, * FROM jobs WHERE id = ? AND owner = ?", (job_id, owner)).fetchone()
        if row is None:
            return None
        ahead = self._db.execute(f"SELECT COUNT(*) FROM jobs WHERE status IN {_in(ACTIVE)} AND rowid < ?", (row["seq"],)).fetchone()[0]
        job = {
            "id": row["id"], "file_name": row["file_name"], "status": row["status"],
            "done": row["done"], "total": row["total"], "error": row["error"],
            "queue_position": ahead if row["status"] == "queued" else 0,
        }
        if row["status"] == "done" and row["result"]:
            job["result"] = json.loads(row["result"])
        return job

    def get(self, job_id: str, owner: str) -> dict[str, Any] | None:
        """The job as its owner sees it; None for anyone else (or no such job)."""
        with self._lock:
            return None if self._closed else self._view(job_id, owner)

    def wait_for(self, job_id: str, owner: str, statuses: tuple[str, ...] = FINISHED, timeout: float = 30.0) -> dict[str, Any] | None:
        """Blocks until the job is in one of `statuses` (or gone), woken by every change — no polling."""
        deadline = time.monotonic() + timeout
        with self._changed:
            while True:
                job = None if self._closed else self._view(job_id, owner)
                if job is None or job["status"] in statuses:
                    return job
                left = deadline - time.monotonic()
                if left <= 0:
                    raise TimeoutError(f"job {job_id} still {job['status']} after {timeout:.0f}s")
                self._changed.wait(left)

    def counts(self) -> dict[str, int]:
        with self._lock:
            if self._closed:
                return {}
            rows = self._db.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").fetchall()
        return {r["status"]: r["n"] for r in rows}


RunFn = Callable[[Path, Callable[[int, int], None]], dict[str, Any]]


class Worker:
    """One thread that runs queued jobs in order. `run(path, progress)` does the labeling."""

    def __init__(self, store: JobStore, run: RunFn) -> None:
        self.store = store
        self.run = run
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._cancel: dict[str, threading.Event] = {}
        self._stopping = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="yetnew-labeling", daemon=True)
        self._thread.start()

    def submit(self, job_id: str) -> None:
        self._cancel[job_id] = threading.Event()
        if self.store.transition(job_id, ("receiving",), "queued"):
            self._queue.put(job_id)

    def cancel(self, job_id: str) -> None:
        """Still queued: cancelled at once. Running: stops at its next progress report."""
        if self.store.transition(job_id, ("queued",), "cancelled", error="Cancelled."):
            self.store.remove_upload(job_id)
            return
        event = self._cancel.get(job_id)
        if event:
            event.set()

    def stop(self, timeout: float = 30.0) -> None:
        """Shutdown: no new job starts (queued ones stay queued and are marked failed at
        the next start); the running one is cancelled at its next progress report."""
        self._stopping.set()
        for event in list(self._cancel.values()):
            event.set()
        self._queue.put(None)
        self._thread.join(timeout=timeout)

    def _loop(self) -> None:
        while (job_id := self._queue.get()) is not None:
            try:
                self._run_one(job_id)
            except Exception:  # noqa: BLE001 — the worker must survive anything one job does
                log.exception("labeling job %s: worker error", job_id)
            finally:
                self._cancel.pop(job_id, None)
                self.store.remove_upload(job_id)

    def _run_one(self, job_id: str) -> None:
        if self._stopping.is_set():
            return  # shutting down: leave it queued
        if not self.store.transition(job_id, ("queued",), "running"):
            return  # cancelled (or expired) while waiting
        cancel = self._cancel.get(job_id) or threading.Event()

        def progress(done: int, total: int) -> None:
            if cancel.is_set():
                raise JobCancelled
            self.store.progress(job_id, done, total)

        final: tuple[str, dict[str, Any]]
        try:
            result = self.run(self.store.upload_dir(job_id) / "upload.dxf", progress)
        except JobCancelled:
            final = ("cancelled", {"error": "Cancelled."})
        except UserFacingError as err:
            final = ("failed", {"error": str(err)})
        except Exception:  # noqa: BLE001 — a job must end in a state, whatever happened
            log.exception("labeling job %s failed", job_id)
            final = ("failed", {"error": "Labeling failed because of an internal error. Try again."})
        else:
            final = ("cancelled", {"error": "Cancelled."}) if cancel.is_set() else ("done", {"result": json.dumps(result)})
        # The file goes first: once a job reads as finished, its upload is gone.
        self.store.remove_upload(job_id)
        self.store.transition(job_id, ("running",), final[0], **final[1])
