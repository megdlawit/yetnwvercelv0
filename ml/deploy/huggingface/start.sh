#!/usr/bin/env bash
# Starts Ollama, checks the fine-tuned assistant's chat template on THIS
# Ollama version (required — without a passing check the service uses the
# base model), then the service on the Space's port, sign-in required.
set -u

: "${SUPABASE_URL:?Set SUPABASE_URL as a Space secret}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY as a Space secret}"
: "${YETNEW_CORS_ORIGINS:?Set YETNEW_CORS_ORIGINS (your site, e.g. https://yetnew.vercel.app) as a Space variable}"
export YETNEW_REQUIRE_AUTH=1

ollama serve > /tmp/ollama.log 2>&1 &
for i in $(seq 1 120); do curl -sf http://127.0.0.1:11434/api/version > /dev/null && break; sleep 1; done
echo "Ollama $(curl -s http://127.0.0.1:11434/api/version)"

# A failed check is not fatal: the service then answers with the base model and says why on /health.
python scripts/check_template.py --model yetnew-assistant || echo "Template check failed — the assistant uses the base model until it passes."

exec python -m server --host 0.0.0.0 --port "${PORT:-7860}"
