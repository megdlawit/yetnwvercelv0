# Host the Yet New AI service for free (Hugging Face Spaces)

The layer labeler and the map assistant — your own fine-tuned model — on a
free Hugging Face Space (CPU basic: 2 vCPU, 16 GB RAM). The website and
database stay where they are (Vercel, Supabase); the editor talks to the
Space instead of your laptop.

**What it costs:** nothing. **What to expect:** answers in ~15–40 s (CPU, like
your laptop); a free Space that nobody uses goes to sleep and takes a few
minutes to wake on the next request. Jobs and uploads are kept only while it
runs (drawings are deleted after labeling anyway).

**Not tested yet:** the image hasn't been built outside Hugging Face (no
Docker on the development laptop). If the build fails, send the log.

## 1. Build the folder to upload (on your laptop)

```powershell
cd ml
.venv\Scripts\python.exe deploy\huggingface\make_space.py
```

It writes `ml\deploy\huggingface\build\` (~2 GB) with only what the service
needs, and refuses a model that isn't the approved one installed as
`yetnew-assistant` — so it is always the version that passed the tests.

## 2. Create the Space

1. Sign up at huggingface.co (free).
2. **New → Space.** Name: `yetnew-ai`. SDK: **Docker** (Blank). Hardware:
   **CPU basic (free)**. Visibility: **Public** — the website calls it from
   visitors' browsers; the service itself only answers signed-in Yet New users.
3. In the Space: **Settings → Variables and secrets**:
   - Secret `SUPABASE_URL` — your Supabase project URL
   - Secret `SUPABASE_ANON_KEY` — the publishable (anon) key
   - Variable `YETNEW_CORS_ORIGINS` — your site, e.g. `https://yetnew.vercel.app`

   Without these the service refuses to start: it never runs without sign-in.

## 3. Upload

1. Create an access token: huggingface.co → **Settings → Access Tokens → New
   token**, type **Write**.
2. In PowerShell:
   ```powershell
   pip install -U huggingface_hub
   huggingface-cli login            # paste the token
   huggingface-cli upload <your-username>/yetnew-ai ml\deploy\huggingface\build . --repo-type space
   ```
   (Newer versions call the command `hf` instead of `huggingface-cli`.) The 2 GB
   model goes up as a large file automatically; it takes a while.

## 4. Wait for the build, then check it

- The Space's **Logs** tab shows the build (~10–20 min: installing, then
  downloading qwen2.5:3b and creating your model) and the start, ending with
  `Template check passed` and the server running.
- Open `https://<your-username>-yetnew-ai.hf.space/health`. You want
  `"status": "ok"` and `"ollama": "ok"`.

## 5. Point the website at it

In Vercel: **Project → Settings → Environment Variables**:
`VITE_LAYER_LABELER_URL` = `https://<your-username>-yetnew-ai.hf.space`,
then **redeploy**. The editor now uses the Space for the layer labeler and as
the assistant's model — no laptop needed. (Claude stays off unless you also set
`ANTHROPIC_API_KEY`.)

## Updating the model later

After a new assistant has won locally (installed as `yetnew-assistant`,
`eval_assistant.py --write`), run step 1 again and upload again (step 3). The
Space rebuilds with the new model and re-runs the template check on start.
