"""Who may call /classify: anyone signed in to Yet New (a Supabase session).

The bearer token is checked by Supabase itself (GET /auth/v1/user), so no
JWT secret lives here and it keeps working when Supabase rotates keys.
Valid sessions are cached briefly so a page of retries isn't a page of calls.

Off by default for local development; set YETNEW_REQUIRE_AUTH=1 (plus
SUPABASE_URL and SUPABASE_ANON_KEY) before running anywhere but localhost.
"""

from __future__ import annotations

import ipaddress
import os
import time
from dataclasses import dataclass

import httpx

_CACHE_SECONDS = 60.0
_cache: dict[str, tuple[float, str]] = {}  # token → (valid until, user id)

#: The job owner when auth is off (one person on one machine).
LOCAL_USER = "local"


@dataclass(frozen=True)
class AuthSettings:
    required: bool
    supabase_url: str
    anon_key: str


def load_auth_settings() -> AuthSettings:
    return AuthSettings(
        required=os.environ.get("YETNEW_REQUIRE_AUTH", "0").strip() in {"1", "true", "yes"},
        supabase_url=(os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").rstrip("/"),
        anon_key=os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY") or "",
    )


def is_loopback(host: str) -> bool:
    """True for addresses that only this machine can reach (127.0.0.0/8, ::1, localhost)."""
    if host.strip().lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip().strip("[]")).is_loopback
    except ValueError:
        return False


class AuthError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def check_bearer(authorization: str | None, settings: AuthSettings) -> str:
    """The caller's Supabase user id (LOCAL_USER when auth is off). Raises AuthError otherwise."""
    if not settings.required:
        return LOCAL_USER
    if not settings.supabase_url or not settings.anon_key:
        raise AuthError(500, "Auth is required but SUPABASE_URL / SUPABASE_ANON_KEY are not set on the service.")
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise AuthError(401, "Sign in first.")
    now = time.monotonic()
    cached = _cache.get(token)
    if cached and cached[0] > now:
        return cached[1]
    try:
        resp = httpx.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": settings.anon_key},
            timeout=10.0,
        )
    except httpx.HTTPError as err:
        raise AuthError(503, f"Can't reach Supabase to check the session ({type(err).__name__}).") from err
    try:
        body = resp.json() if resp.status_code == 200 else {}
    except ValueError:
        body = {}
    user_id = body.get("id") if isinstance(body, dict) else None
    if not isinstance(user_id, str) or not user_id:
        raise AuthError(401, "Your session has expired. Sign in again.")
    _cache[token] = (now + _CACHE_SECONDS, user_id)
    return user_id
