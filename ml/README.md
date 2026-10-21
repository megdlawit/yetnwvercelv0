# Yet New — AI layer labeling

When an admin imports a CAD drawing (DXF, or DWG converted to DXF), a local
model suggests what each layer is — `wall`, `door`, `stairs`, … — and the
admin confirms every suggestion before the venue is created. Confirmed labels
from venues that allow it can become training data for a fine-tuned model,
which replaces the zero-shot one only if it clearly beats it.

Everything runs on free, local tools: Ollama for inference, a free Colab GPU
for training. No paid APIs.

**Rules this code enforces**

- No AI label reaches a venue without a person confirming it (`CONFIRM_ALL_LAYERS` in `yetnew_layers/labels.py`).
- `ignore`, `walkable` and `unknown` are never confirmed by group. **"Looks right — confirm all"** confirms every
  remaining layer in one click (venue managers judge the map preview, not layer names); a layer nobody could name
  takes the rules' suggestion or is left out. One-click (bulk) confirmations are never training data.
- Empty layers are `ignore` without asking the model (`classify.skip_empty`): most layers in real drawings are empty.
- Walkable paths are always built from the geometry. `walkable` is a stored hint only.
- Fine-tuning is for layer labels only. It never stores venue facts.
- **No customer data leaves the database until the consent notice has had legal review** (`YETNEW_LEGAL_REVIEWED_NOTICE_VERSION`).
- Training data: only layers confirmed individually or by group (never "confirm all"), only from venues whose owner allows it **now**, no text samples unless switched on deliberately.
- Held-out venues are frozen: once held out, never trained on.
- The fine-tuned model is used only after `check_template.py` passed for it on the current Ollama version, and `evaluate.py` approved it.
- The synthetic fixture, notebook smoke-test models and downloaded test files are never training data or service models.

---

## 1. Set up (Windows, once)

Installed for this project: Python 3.12 (`winget install Python.Python.3.12`) and Ollama (`winget install Ollama.Ollama`).

```powershell
cd ml
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[server,dev]"
ollama pull qwen2.5:3b            # the baseline (~2 GB). 7B needs ~5.5 GB free RAM.
.venv\Scripts\python.exe -m pytest -q
```

## 2. Run the service

```powershell
cd ml
.venv\Scripts\python.exe -m server              # http://127.0.0.1:8787
curl.exe http://127.0.0.1:8787/health           # Ollama, active model, template check, queue
```

Then `npm run dev` in the repo root. In development the editor finds the
service at `http://127.0.0.1:8787`; a production build needs
`VITE_LAYER_LABELER_URL`. Floor editor → Import CAD → **Review layers**.

API: `POST /jobs` (multipart `file`) → `GET /jobs/{id}` (progress, then the
result) → `DELETE /jobs/{id}` (cancel). On a laptop CPU an 18-layer drawing
takes 1–2 minutes.

### Settings (environment variables)

| Variable | Default | What |
|---|---|---|
| `YETNEW_BASE_MODEL` | `qwen2.5:3b` | Zero-shot model in Ollama |
| `YETNEW_FT_MODEL` | `yetnew-layers` | Fine-tuned model name in Ollama |
| `YETNEW_MODEL` | `auto` | `auto` / `baseline` / `finetuned` (finetuned still needs a current template check) |
| `YETNEW_RETRIEVAL_K` | `0` | Retrieved examples per layer for the baseline (0 = off; max 8) |
| `YETNEW_EXAMPLE_BANK` | `data/dataset/example_bank.jsonl` | Confirmed layers retrieval draws from (written by the export) |
| `YETNEW_ASSISTANT_MODEL` / `YETNEW_ASSISTANT_EXAMPLES` / `YETNEW_ASSISTANT_EXAMPLE_MODE` | `qwen2.5:3b` / `0` / `menu` | The local assistant's base model; worked examples on (1) or off (0); `menu` (one per action) or `nearest` |
| `YETNEW_INCLUDE_TEXT_SAMPLES` | `0` | Text written in drawings in prompts, exports and training — one switch for all |
| `YETNEW_NUM_CTX` | `8192` | Context window sent with every request; batches are planned to fit |
| `YETNEW_BATCH_SIZE` | `15` | Max layers per baseline request |
| `YETNEW_LEGAL_REVIEWED_NOTICE_VERSION` | — | Set to the consent notice version (1) **after** legal review; enables customer exports |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | |
| `YETNEW_MAX_UPLOAD_MB` | `50` | |
| `YETNEW_MAX_JOBS` / `YETNEW_JOB_TTL_MIN` | `4` / `60` | Queue size; finished jobs (and results) deleted after |
| `YETNEW_REQUIRE_AUTH` | `0` | `1` = Supabase session required (needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`) |
| `YETNEW_CORS_ORIGINS` | `http://localhost:8080,http://127.0.0.1:8080` | |

### On a server

Without auth the service only serves its own machine: `python -m server
--host 0.0.0.0` refuses to start, and requests from elsewhere get 403.

```bash
export YETNEW_REQUIRE_AUTH=1 SUPABASE_URL=https://<project>.supabase.co SUPABASE_ANON_KEY=<publishable key>
export YETNEW_CORS_ORIGINS=https://<your site>
python -m server --host 0.0.0.0 --port 8787     # behind HTTPS (nginx/Caddy), Ollama on the same machine
```

After **every Ollama upgrade** on that machine, run `check_template.py --model yetnew-layers` again (§4.4); until then the service uses the baseline.

## 3. Labels

| Label | Becomes in the editor |
|---|---|
| wall, door, window, stairs, elevator, furniture | the same category |
| room | rooms |
| restroom | rooms, with room type `restroom` |
| vegetation | trees & plants |
| text | labels |
| walkable | ignored for geometry — a hint only, never used for paths |
| dimension, ignore | ignored |
| unknown | blocks "Create venue" until changed |

What each label means (and the examples the model sees) is `LABEL_GUIDE` in
`yetnew_layers/prompt.py` — the only place prompts are built, for inference,
retrieval and training alike. Changing it bumps `PROMPT_VERSION` and means
re-exporting and retraining.

## 4. The improvement loop

```
 confirm in the editor ─► export ─► train (Colab) ─► ollama create ─► check_template (REQUIRED) ─► evaluate ─► switch (only if it won)
```

### 4.1 Collect

Admins import venues and confirm layers (Supabase `layer_labels`; migrations
`20261010090000` + `20261010110000`; staging checklist in
`supabase/tests/LAYER_LABELS_STAGING.md`). The venue's institution owner decides
training consent in the import dialog; withdrawing it takes the venue out of
every future export.

### 4.2 Export

Disabled until the consent notice (`src/lib/cad/layerLabels/consent.ts`,
marked LEGAL REVIEW NEEDED) has been reviewed. Then:

```powershell
cd ml
$env:YETNEW_LEGAL_REVIEWED_NOTICE_VERSION = "1"
$env:SUPABASE_URL = "https://<project>.supabase.co"
$env:SUPABASE_ANON_KEY = "<publishable key>"
$env:YETNEW_ADMIN_TOKEN = "<a platform admin's access token>"     # or $env:SUPABASE_SERVICE_ROLE_KEY
.venv\Scripts\python.exe scripts\export_dataset.py --out data\dataset
```

It prints label counts per split and the data-quality warnings. Output in
`data/dataset/`: `train.jsonl`, `val.jsonl`, `val_layers.jsonl`,
`example_bank.jsonl` (training venues only), `manifest.json`.

**Held-out venues are frozen** in `heldout/venues.json` (opaque venue ids;
keep it — commit it or back it up). It only grows: a held-out venue stays held
out in every later export, a training venue never becomes validation, and new
venues are held out until about 20% are. Never edit or delete it; if it is
lost, earlier held-out venues may end up in training.

### 4.3 Train (Google Colab, free T4)

1. Zip `data/dataset` → `dataset.zip`.
2. Open `notebooks/train_yetnew_layers.ipynb` in Colab (File → Upload notebook), Runtime → T4 GPU.
3. **First time: smoke mode.** Set `SMOKE_TEST = True`, upload the synthetic dry-run zip (§6), run all. It trains 5 steps to prove the environment works, exports nothing, and tells you to delete the runtime (Runtime → Disconnect and delete runtime). Its output is named `SMOKE-TEST-delete-me`; the service and `evaluate.py` refuse any model with "smoke" in its name.
4. Real run: `SMOKE_TEST = False`, upload `dataset.zip`, run all. Defaults: Qwen2.5-3B-Instruct 4-bit, LoRA r=16, 2 epochs (`BASE_MODEL`, `EPOCHS`).
5. It shows validation accuracy and every mistake, checks the GGUF's embedded chat template, and downloads `yetnew-layers.Q4_K_M.gguf` and the LoRA adapter.

### 4.4 Install and check — REQUIRED after every `ollama create` and every Ollama upgrade

```powershell
# put yetnew-layers.Q4_K_M.gguf in ml\ollama\, then from ml\:
ollama create yetnew-layers -f ollama\Modelfile
.venv\Scripts\python.exe scripts\check_template.py --model yetnew-layers
```

It proves, through Ollama, that a chat request gives the model exactly its
training text (same answer, prompt token count and log-probs as the raw
training text), and records the result for this Ollama version and model
digest in `template_check.json`. Re-creating the model or upgrading Ollama
makes the record stale: the service falls back to the baseline and
`evaluate.py` won't record a choice until the check passes again.
(Ollama 0.40.2 renders chats with the GGUF's embedded template, not the
Modelfile's `TEMPLATE`; the check covers whichever is used.)

### 4.5 Evaluate and switch

```powershell
.venv\Scripts\python.exe scripts\evaluate.py --dataset data\dataset           # report
.venv\Scripts\python.exe scripts\evaluate.py --dataset data\dataset --write   # record the choice
```

Three options label the same frozen held-out venues through Ollama: the
baseline, the baseline with retrieved examples, and the fine-tuned model. You
get overall, **per-label (side by side, for your review)** and per-venue
accuracy and the commonest mistakes (`data/dataset/eval_report.json`).

The fine-tuned model replaces the service's current mode (baseline, or
retrieval if `YETNEW_RETRIEVAL_K` > 0) only if **all** hold:

- accuracy **≥ 3 points** higher;
- the **95% confidence interval** of the difference is above 0 (bootstrap over whole venues);
- **no drop on `wall`, `walkable` or `ignore`**.

`model_choice.json` is written only with `--write` and when: the data is real;
**≥ 3** held-out venues, **≥ 100** layers and **≥ 10 per label** (including
wall, walkable, ignore); the export matches the current prompt version and text
setting; and the template check is current. The service reads the choice per
job (no restart). Retrieval is reported against the same rule; turning it on
is your call (`YETNEW_RETRIEVAL_K=3`).

**Retrieval results are only a headline number when no example came from the
venue being scored.** Each held-out layer gets its examples with its own venue
excluded, and `evaluate.py` then checks every example it used. Only if all
came from other venues does retrieval appear in the overall results and the
switch rule, with the line "every retrieved example came from a different
venue than the layer it was shown with". Otherwise it is printed separately as
*diagnostic only*, says how many examples came from the same venue, and is
used in no comparison: an example from the same drawing can simply give the
answer away. The check is by venue id: the same drawing imported as two
different venues would still leak (that is exactly why the synthetic dry run,
five renamed copies of one drawing, shows retrieval near 100%).

### 4.6 The first real venues (e.g. Unity Park)

1. Save the drawing as `ml/data/<venue>.dxf` (git-ignored) and write down where it came from (architect, date).
2. Runtime check: `.venv\Scripts\python.exe scripts\smoke_test.py data\<venue>.dxf --summarize-only`, then without `--summarize-only`.
3. On **staging**, import it in the floor editor and confirm **every layer individually** — no "Confirm group", no "Confirm all" — for the first real venue. It sets the reference for what each label means; group and bulk come later, once the labels are settled.
4. **Record who labeled it**: the account is stored in `layer_labels.created_by`; also write the person's name, role and the date next to the drawing's source note (e.g. `ml/data/<venue>.labeling.txt`, git-ignored). Two people labeling the same venue differently is a data problem worth knowing about.
5. Measure the baseline. Report accuracy **by layer and weighted by entity count** — a wrong label on a 2,000-line wall layer matters more than on an empty layer:

   ```sql
   select coalesce(final_label, 'ALL') as label,
          count(*)                                                        as layers,
          round(100.0 * avg((not was_corrected)::int), 1)                 as pct_layers_right,
          sum((layer_summary->>'total')::int)                             as entities,
          round(100.0 * sum(case when not was_corrected then (layer_summary->>'total')::int else 0 end)
                / nullif(sum((layer_summary->>'total')::int), 0), 1)       as pct_entities_right,
          bool_and(confirmed_via = 'individual')                          as all_individual
   from layer_labels
   where file_name ilike '%<venue>%' and human_verified
   group by rollup(final_label) order by final_label nulls last;
   ```

   Also compare `ai_confidence` with `was_corrected`: the wrong ones should mostly be the low-confidence ones.
6. One venue can't be exported or trained on (minimum 3, aim for 15–30) — keep collecting.

### 4.7 Measuring on test drawings (gold set) — no training involved

Before real venues exist, measure the baseline on drawings you label yourself:

```powershell
.venv\Scripts\python.exe scripts\inventory_dxf.py data\smoke\*.dxf --json data\inventory.json   # which files have real layers?
.venv\Scripts\python.exe scripts\make_gold.py data\smoke\<drawing>.dxf                          # → data\gold\<drawing>.csv, my_label EMPTY
#   fill in my_label by hand (Excel/Sheets, save as CSV) — rules and label guide in data\gold\README.md
.venv\Scripts\python.exe scripts\score_gold.py                                                     # baseline, retrieval OFF
```

It reports accuracy by layer and by entity count, per label and per file, every
wrong layer (biggest first), confidence on right vs wrong answers, and flags
mistakes on wall / walkable / ignore and on big layers — and says how many
files and layers that is. Sources and licenses of test files: `data/SOURCES.md`.
Never change the prompt from one file's mistakes.

### 4.8 Drawings from people who aren't architects

Many uploads keep (almost) everything on ONE layer — files from download sites,
converters, or traced images. Layer labels can't separate walls from furniture
there, so the import dialog says so in plain words (the service reports
`drawing.single_layer`). For training, `export_dataset.py --generic-names 1` adds
copies of each training layer under meaningless names (Layer 3, 0, New Layer)
so the model learns to judge by content; it is off by default — turn it on only
if `evaluate.py` shows it helps.

## 5. The free map-editor assistant

The floor editor's chat understands common requests itself (`src/lib/assistant/intent.ts`).
Everything else now goes to a **free local model** first — `POST /assistant` on
this service, same request and answer as the Claude route — and to Claude only
if the local service isn't running. One contract for both:
`src/lib/assistant/assistantSpec.ts` (`assistant/spec.json` and
`assistant/messages_fixture.json` are generated from it; tests fail if they drift).

```powershell
.venv\Scripts\python.exe scripts\make_assistant_data.py --train 3400          # 3,400 training + 300 test requests (generated)
.venv\Scripts\python.exe scripts\eval_assistant.py --limit 60                  # measure the base model (slow on CPU)
.venv\Scripts\python.exe scripts\check_notebook_data.py                         # before uploading: the notebooks' data checks on CPU
#   (needs: pip install -e ".[notebook-check]" and data\assistant_dataset.zip, data\synthetic_dataset_SMOKE_ONLY.zip)
# Kaggle or Colab: notebooks\train_map_assistant.ipynb (smoke mode first; ~108 s/step on a T4, so EPOCHS = 1 is ~5 h), then:
ollama create yetnew-assistant -f ollama\Modelfile.assistant
.venv\Scripts\python.exe scripts\check_template.py --model yetnew-assistant    # REQUIRED after every create / Ollama upgrade
.venv\Scripts\python.exe scripts\eval_assistant.py --finetuned yetnew-assistant --write
```

The data is **generated**: requests written the way non-experts type (casual,
short, typos, lower-case names, "this / it / here", questions, unclear
requests) from their correct answers, on generated venues; whole phrasings are
held out for testing. It contains no customer data. The fine-tuned assistant is
used only when it beats the base model by 5+ points (95% interval above 0, no
drop on asking back or on remove / disconnect / publish), on 200+ test requests,
with a current template check (`assistant_choice.json`).

**Live: v3 (2026-10-21, 1 epoch on 4,200 requests): 98.0% exact** on the same 200
held-out requests (v2 94.0%, base 50.0%). One regression against v2 on a
protected kind — "X and Y shouldn't be connected" answered with a connect — was
accepted by the project owner because that phrasing is caught before any model
(`intent.ts`) and `guardModelActions` turns any connect on a "don't connect"
request into a question. Rollback: `ollama cp yetnew-assistant-v2 yetnew-assistant`,
`check_template.py --model yetnew-assistant`, `eval_assistant.py --finetuned yetnew-assistant --write`.

**First fine-tuned model (2026-10-19, Kaggle T4, 1 epoch on 2,500 requests):**
**81.5% exact** vs 50.0% for qwen2.5:3b on the same 200 held-out requests
(`test_fresh2.jsonl`), +31.5 points (95% CI +19.2 … +46.2), no regressions →
approved. It answers **without** the structured-output schema
(`FINETUNED_SCHEMA` in `assistant.py`): with it, it picked wrong field names
(66.0%). Still wrong: asking back, "it", "bigger", the path tool, wall
height — their only phrasing was held out. The held-out set is now frozen
(`HELD_OUT` in `assistant_data.py`), and training-only phrasings for those
behaviours were added; the test files are unchanged. Saved answers are keyed
by the model's digest, so a retrained model is always asked again. The
previous model is kept as `yetnew-assistant-v1` in Ollama.

Measured 2026-10-12, before any training: **qwen2.5:3b, 41.7% exact** on 60
held-out requests (63% right action types, 100% valid JSON, ~37 s per request on
this laptop's CPU). Its mistakes are systematic (rename read as remove+add,
"bigger" read as a new size, redo read as undo) — the kind fine-tuning fixes.

**Worked examples (no training needed):** `YETNEW_ASSISTANT_EXAMPLES=1` shows the
base model a fixed **menu** — one clean worked example per kind of action
(undo, redo, open, go to floor…, 33 in all) — before each request. Fixed, so
Ollama keeps it cached. The fine-tuned model never gets examples (it learned them).

What was measured (base qwen2.5:3b, generated held-out phrasings):
- 4 *nearest* examples (`YETNEW_ASSISTANT_EXAMPLE_MODE=nearest`): 46.5% → 65.0% on
  200 requests — but **undo fell from 86% to 0%**: look-alike requests ("hi, go
  back" next to "hi, go to First") misled the model. Not used.
- The menu replaces it; it is being measured on a **fresh** draw of 200
  held-out requests (`--test-file test_fresh.jsonl`), since the first 200 were
  looked at while diagnosing. Switch it on only if it passes the rule — which now
  also forbids any drop on undo.

```powershell
.venv\Scripts\python.exe scripts\eval_assistant.py --examples 1 --example-mode menu --test-file test_fresh.jsonl --limit 200
```

Gaps: English only (Amharic requests must be written and checked by a native
speaker), and generated phrasings are not real conversations — collecting
real requests with the action the manager accepted (with consent) is the next
data source.

## 6. Data quality

| Rule | Why |
|---|---|
| **15–30 varied venues** (offices, parks, museums, different architects) | Learn conventions, not one office's habits |
| **500+ labeled layers** in total | Below this a 3B model mostly memorizes |
| **20+ examples per label** in training, **10+ per label held out** | Rare labels are otherwise guessed — and can't be measured |
| **Consistent labels** — follow the guide in `prompt.py`; `ignore` vs `unknown` matters | Contradicting labels teach noise |
| Confirm one by one or by group; "Confirm all" is never trained on | Bulk confirmations aren't careful decisions |
| Hold out whole venues, frozen | Same-venue layers in both splits, or reshuffling, inflate accuracy |
| Never: the synthetic fixture, smoke-test models, downloaded sample files, venues without consent | |

## 7. Tests and checks

```powershell
cd ml; .venv\Scripts\python.exe -m pytest -q          # 133 tests: summarizer, labels, prompts, batching, retrieval, service, jobs,
                                                      # dataset/legal gate/frozen split, evaluate, gold set, assistant, Modelfiles, notebooks
.venv\Scripts\python.exe scripts\check_template.py    # live: Modelfile vs training text via a throwaway model, + garbage-TEMPLATE control
cd ..; npx vitest run src/lib/cad/layerLabels src/components/venue/LayerReviewPanel.test.tsx
node supabase/tests/run_layer_labels_rls_pglite.mjs   # RLS (after: npm i --no-save @electric-sql/pglite@0.5.8)
```

Pipeline dry run on the synthetic fixture (never training data; no legal flag needed):

```powershell
.venv\Scripts\python.exe tests\fixtures\make_synthetic_export.py
.venv\Scripts\python.exe scripts\export_dataset.py --from-json data\synthetic_export.json --synthetic-dry-run --out data\dataset
.venv\Scripts\python.exe scripts\evaluate.py --dataset data\dataset-SYNTHETIC --finetuned qwen2.5:3b    # stand-in model
```

Zip `data\dataset-SYNTHETIC` for the notebook's smoke mode. Runtime smoke test
on local drawings: `scripts\smoke_test.py <files> [--expected …]`.

## 8. Files

| Path | What |
|---|---|
| `yetnew_layers/summarize.py` | DXF → per-layer summary (ezdxf) |
| `yetnew_layers/labels.py` | The 14 labels, review gate |
| `yetnew_layers/prompt.py` | All prompts (baseline, retrieval, fine-tuned), label guide, text switch, token budget |
| `yetnew_layers/classify.py` | Baseline (batched, optional retrieval) and fine-tuned labeling, log-prob confidence |
| `yetnew_layers/retrieval.py` | Example bank and nearest confirmed layers |
| `yetnew_layers/models.py` | Which model the service uses |
| `yetnew_layers/template_check.py` | Template-check records (per Ollama version + model digest) |
| `yetnew_layers/dataset.py`, `scripts/export_dataset.py` | Export, legal gate, frozen split (`heldout/venues.json`) |
| `yetnew_layers/evaluate.py`, `scripts/evaluate.py` | Three-way comparison through Ollama, switch rule |
| `yetnew_layers/chat_format.py`, `templates/`, `ollama/Modelfile`, `scripts/check_template.py` | Chat format and its checks |
| `notebooks/train_yetnew_layers.ipynb` | Colab training (and smoke mode) |
| `yetnew_layers/gold.py`, `scripts/make_gold.py`, `scripts/score_gold.py`, `scripts/inventory_dxf.py` | Hand-labeled test drawings and their scoring |
| `yetnew_layers/assistant*.py`, `scripts/make_assistant_data.py`, `scripts/eval_assistant.py`, `assistant/`, `ollama/Modelfile.assistant`, `notebooks/train_map_assistant.ipynb` | The free map-editor assistant |
| `server/` | FastAPI service, jobs, auth |
| `tests/fixtures/` | SYNTHETIC fixture — tests only |

## 9. Not verified yet

- The notebook has never run (no GPU here): versions and APIs were checked against the pinned wheels, not executed. Smoke mode is the way to verify it.
- Accuracy on real venues — including whether retrieval helps — waits for real confirmed data.
- The assistant notebook has never run either; the assistant's 41.7% is on generated English requests, not real conversations.
