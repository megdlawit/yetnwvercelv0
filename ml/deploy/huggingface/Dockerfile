# Yet New AI service (layer labeler + map assistant) for a free Hugging Face
# Docker Space (CPU basic: 2 vCPU, 16 GB RAM). Built from the folder that
# deploy/huggingface/make_space.py writes — not from ml/ directly.
#
# The models are baked into the image at build time (no 2 GB download on
# every start): qwen2.5:3b from the Ollama library, and the fine-tuned
# assistant from ollama/yetnew-assistant.Q4_K_M.gguf in this folder.

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates zstd \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://ollama.com/install.sh | sh

# Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    OLLAMA_MODELS=/home/user/ollama-models \
    OLLAMA_HOST=127.0.0.1:11434 \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user pyproject.toml ./
COPY --chown=user yetnew_layers ./yetnew_layers
COPY --chown=user server ./server
RUN pip install --no-cache-dir ".[server]" "jinja2==3.1.6"

COPY --chown=user . .
USER user

# Bake the models in: start Ollama for the build step only.
RUN mkdir -p "$OLLAMA_MODELS" data \
    && (ollama serve > /tmp/ollama-build.log 2>&1 &) \
    && for i in $(seq 1 60); do curl -sf http://127.0.0.1:11434/api/version > /dev/null && break; sleep 1; done \
    && ollama pull qwen2.5:3b \
    && ollama create yetnew-assistant -f ollama/Modelfile.assistant

EXPOSE 7860
CMD ["bash", "start.sh"]
