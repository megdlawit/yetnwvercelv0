"""Starts the service: python -m server [--host 127.0.0.1] [--port 8787].

Refuses to listen on anything but loopback unless YETNEW_REQUIRE_AUTH=1 (and
the Supabase settings auth needs) are set: without auth, anyone who can reach
the port could upload files and use the machine's CPU.
"""

from __future__ import annotations

import argparse
import sys

import uvicorn

from .auth import is_loopback, load_auth_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m server", description="Yet New layer-labeling service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args(argv)

    auth = load_auth_settings()
    if not is_loopback(args.host):
        if not auth.required:
            print(f"Refusing to listen on {args.host}: set YETNEW_REQUIRE_AUTH=1 (with SUPABASE_URL and "
                  "SUPABASE_ANON_KEY) to serve other machines, or use --host 127.0.0.1.", file=sys.stderr)
            return 2
        if not auth.supabase_url or not auth.anon_key:
            print("YETNEW_REQUIRE_AUTH=1 needs SUPABASE_URL and SUPABASE_ANON_KEY.", file=sys.stderr)
            return 2

    uvicorn.run("server.app:app", host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
