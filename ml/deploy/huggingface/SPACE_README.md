---
title: Yet New AI
emoji: 🗺️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Yet New AI service

The layer labeler and the map assistant for Yet New, on a free
CPU Space. Sign-in required: requests need a Yet New (Supabase) session.

- `GET /health` — status, models, template check
- `POST /jobs` — label a DXF's layers (the editor's import)
- `POST /assistant` — the map assistant

Built by `ml/deploy/huggingface/make_space.py` in the Yet New repository; see
`ml/deploy/huggingface/GUIDE.md` there.
