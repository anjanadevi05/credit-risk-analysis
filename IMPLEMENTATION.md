# Credit Risk Analysis — Implementation Summary

This document describes what the project does today, how to run it, data requirements, and troubleshooting.

## Architecture (high level)

1. **MySQL (`company_data.entities_final_1`)** — Entity master data, optional `metrics_json` (financial CSV fields), optional `evaluation_cache` (last evaluate response), `score` (gauge number).
2. **Node backend (`backend_intermediate`, port 3000)** — CRUD for entities, score updates, evaluation cache, metrics upload.
3. **Python LLM API (`llm_intermediate/llm.py`, port 5000)** — Loads rule CSV + company CSV; evaluates factors; builds **deterministic** `advanced_details`; merges **RAG + Ollama JSON** into structured panels. **Ollama is still used** (embeddings + chat JSON). The **main-dashboard gauge narrative** is a short, rule-based paragraph (`gauge_narrative_summary` in `rag.py`: bucket, pressure drivers, offsets, medium count, recommended action). The **Advanced report “Executive summary”** uses the longer **credit-memorandum** text (`_fallback_summary` in `rag.py`), stored as `advanced_details.summary` and duplicated in `memorandum_summary` on the evaluate response. Each evaluate also writes **`llm_intermediate/results/eval_<entity>_<timestamp>.json`** plus a line in **`results/metrics_log.jsonl`** (composite score, RAG flags — similar in spirit to a coverage/metrics artifact).
4. **Qdrant (embedded, on disk under `llm_intermediate/vector_store/`)** — Vector index of threshold rules for RAG.
5. **React frontend (`frontend_intermediate`, Vite)** — Dashboard, login, advanced report page, add entity + optional metrics CSV.

Flow: **Frontend → POST :5000** with entity payload (merged from DB row + `metrics_json`) → **rules engine + report builder + optional RAG/LLM** → response → **optional PUT :3000/UpdateEvaluation** to cache results.

---

## Features implemented

### RAG + vector DB

- Rules from `factor_thresholds_evaluator_global-truth.csv` are embedded and stored in **Qdrant** (local persistent).
- `POST http://127.0.0.1:5000/rag/reindex` rebuilds the index.
- On evaluate, retrieval supplies context for the LLM JSON prompt (when RAG path succeeds).
- **Agentic RAG (lightweight, default on):** a **second retrieval pass** targets high-rated factors, then chunks are **deduped** before the single Ollama JSON call. Disable with env `RAG_AGENTIC=0`. This may change narrative overlap vs references; **BLEU is not guaranteed to improve** (summaries are intentionally template-like).

### Deterministic advanced report (`report_builder.py`)

- Always computes **real** sector, country, revenue tier, composite score, formula string, and portfolio placeholders from **actual** `client_data` (including DB + CSV metrics).
- LLM/RAG output is **merged** on top without wiping numeric scores where the model omits them.

### Entity resolution (important)

- If `entity_id` exists in the static **50-entity CSV**, that row is the base; request JSON **overrides** any field (so DB metrics can patch CSV entities).
- If `entity_id` is **not** in the CSV (e.g. added only in MySQL), the **entire request body** is used as `client_data` — so you **must** send financial columns (via merged `metrics_json` on the frontend).

### Evaluation cache

- After **Evaluate**, the UI calls `PUT /UpdateEvaluation` with `evaluation_cache` (factors, summary, advanced_details, etc.).
- **View** opens the last cached result without calling the LLM again.
- Requires DB migration (see below).

### Add entity + metrics CSV

- **Add New Entity** saves identity fields to MySQL, then **refetches `GetAll`** so the table always mirrors the database (no optimistic-only rows if an insert failed or partially succeeded).
- Optional **CSV** (one data row; header must match template): `public/entity_metrics_template.csv`.
- Row matching `entity_id` is sent to `PUT /entityMetrics` and stored in `metrics_json`; `GetAll` merges those fields into each entity for evaluation.
- **Bulk import:** `POST /bulkImport` — **`INSERT ... ON DUPLICATE KEY UPDATE`** on the five identity columns so **re-importing the same `entity_id` still runs the metrics `UPDATE`** (previously a duplicate-key error skipped the update, leaving scalar columns **NULL** while `metrics_json` could be missing too). Remaining columns go to **`metrics_json`** and to **matching scalar columns**. Node logs **`[BulkImport]`** / **`[DeleteEntity]`** on failures. **Delete:** watch the backend terminal for exact MySQL messages and `tried` id variants.

### Saved reports + summary metrics (thesis)

- Full JSON responses: `llm_intermediate/results/eval_*.json` (git-ignored).
- Run **`python tools/evaluate_summaries.py`** (works **without** `references.jsonl`): writes **`summary_metrics_report.json`** with **ROUGE-L / BLEU** between the short **gauge `summary`** and the long **memorandum** (diagnostic overlap), plus optional **BLEU / ROUGE-L vs gold** when **`results/references.jsonl`** is present (`entity_id` without `#`, plus `reference`). The report **does not** aggregate `final_eval_accuracy_%` / `final_confidence` from eval files (not reliable for thesis). See `results/references.example.jsonl`.

### Gauge vs factor colors

- **Gauge** (0–100): arc colour after **Evaluate** follows **`final_evaluation`** (Low → green, Medium → amber, High → red), aligned with the short summary (“assessed as Medium risk…”). Before evaluation, fallback colours use numeric bands (**≤20 / 21–30 / >30**). Advanced composite **subtext** remains **under 20 / 20–40 / 40+**. **Entity IDs** have **no** `#` in MySQL (`normalizeEntityId`). **Metrics:** **`INSERT` / bulk identity upsert** only guarantees the five identity columns; **financial scalars** fill when a later **`PUT /entityMetrics`**, **bulk metrics path**, or **Evaluate** persistence runs (otherwise expect **NULL** scalars with data possibly only in **`metrics_json`**). Workbench may show NULL if keys did not match **`METRIC_DB_COLUMNS`** (not related to Qdrant).
- **Factor bars/badges**: **Low** = red, **Medium** = amber, **High** = green (strength of that factor’s assessed bucket in the UI).

### Login page

- Purple gradient + **blurred** overlay (matches dashboard palette).
- **User icon** instead of logo image.

### Advanced dashboard (`/advanced`)

- Select entity → **Generate Risk Report** → uses same API; shows **memorandum-style** executive summary (no separate “structured snapshot” block), metric cards, financial/sector/country/portfolio panels, red flags, justification with **composite formula** from the model + deterministic builder.

### Startup RAG reindex (`rag.py`)

- The Flask app triggers a **background reindex** shortly after startup. Qdrant collections are created with `VectorParams` + `Distance` from `qdrant_client.models`. If you see **`name 'VectorParams' is not defined`**, ensure `rag.py` imports `VectorParams` alongside `PointStruct` and `Distance`.

---

## Database migration (required for cache + metrics)

Run once against your MySQL database (default in code: `company_data`):

```sql
-- file: database/migration_evaluation_cache.sql
ALTER TABLE entities_final_1
  ADD COLUMN evaluation_cache LONGTEXT NULL;

ALTER TABLE entities_final_1
  ADD COLUMN metrics_json LONGTEXT NULL;
```

If columns already exist, skip or ignore duplicate-column errors.

---

## How to run

1. **MySQL** running with `company_data` and table `entities_final_1` (plus migration above).
2. **Ollama** running with models (e.g. `mistral`, `nomic-embed-text`).
3. From repo root:
   - First-time: `setup_and_run.bat`
   - Later: `start_only.bat`

Scripts start LLM (port 5000), wait, **retry reindex**, then backend (3000) and frontend (Vite dev server).

### Reindex returns 500

Common causes:

- **Corrupt local Qdrant store** (often after upgrading `qdrant-client` / pydantic): the API **auto-resets** `llm_intermediate/vector_store` once if loading fails, then rebuilds on reindex. You can also delete that folder manually.
- Flask not ready — script waits and **retries** reindex; `llm.py` also runs a **background reindex** a few seconds after startup.
- Rules CSV missing or wrong working directory — ensure `llm.py` is started from `llm_intermediate` (batch files do `cd llm_intermediate`).
- Ollama embedding model missing — pull `nomic-embed-text` or the code falls back to deterministic hash embeddings.
- Check JSON body: `POST /rag/reindex` error field may include `trace` for debugging.

**Ollama was not removed** — it is still used for embeddings (RAG index) and the optional JSON LLM pass. Batch scripts try to start `ollama serve` if `ollama` is on your PATH.

**Agentic RAG** would not fix reindex failures; reindex is indexing + embeddings + local disk, not multi-step retrieval.

---

## Evaluation cache vs browser refresh

Scores and `evaluation_cache` live in **MySQL**. A full page reload refetches `GetAll`; cached factors, summary, and score **persist** until you evaluate again or clear the DB. The dashboard **merges** `last_evaluation` into each row after fetch so the gauge and table score work without re-running Evaluate.

---

## Testing LLM / narrative output (BLEU and friends)

Rule-based factor scores are ground truth from CSV thresholds. For **free-text summaries** (optional):

| Metric | Use |
|--------|-----|
| **BLEU** | N-gram overlap vs reference summaries; fast, harsh on paraphrases. |
| **ROUGE-L** | Common for summarization (subsequence overlap). |
| **BERTScore** | Semantic similarity; better when wording differs. |
| **NLI / faithfulness** | Whether claims follow from retrieved rules + entity facts. |
| **Human rubric** | Clarity and actionability (strong fit for credit narratives). |

For **risk buckets**, report **accuracy / F1 / calibration** against a labeled holdout, not BLEU.

---

## CSV / data needed for evaluation

The Python service evaluates **every factor** listed in `factor_thresholds_evaluator_global-truth.csv` against numeric fields on the entity. Your metrics row should include **all column names** used as `factor` in that rules file (same names as in `credit_risk_dataset_50_entities.csv`).

**Investment-style fields** (e.g. `EAD_usd_m`, `PD_1y_pct`, `LGD_pct`) are **not** required for the core rule engine, but they feed **portfolio** and advanced-report blocks when present. Identity fields (`sector`, `country`) improve narrative context; without metrics, evaluation is thin or defaults apply.

Minimum set includes (examples — confirm against your rules file):

- Liquidity / leverage: `dscr`, `current_ratio`, `quick_ratio`, `debt_to_equity`, `interest_coverage`, …
- P&amp;L / size: `revenue_usd_m`, margins, cash, assets, …
- Risk flags: `payment_incidents_12m`, `sanctions_exposure` / `sanctions_exposure_code`, …
- Advanced report helpers: `country_risk_0_100`, `industry_cyclicality`, `EAD_usd_m`, `PD_1y_pct`, `LGD_pct`, …

Template download in UI: `/entity_metrics_template.csv`.

---

## Agentic RAG

Current design is **single-pass RAG** (retrieve → generate). **Agentic** multi-step RAG (plan → retrieve → verify → refine) is not implemented; it can be added later as an optional mode in `rag.py`.

---

## Key files

| Area | Path |
|------|------|
| LLM API | `llm_intermediate/llm.py` |
| Report builder | `llm_intermediate/report_builder.py` |
| RAG | `llm_intermediate/rag.py` |
| Backend routes | `backend_intermediate/routes/routes.js` |
| Controllers | `backend_intermediate/controller/controller.js` |
| DELETE entity | Registered on `backend_intermediate/index.js` (`app.delete`) so `DELETE /entity` is not lost under Express 5 routing |
| Dashboard | `frontend_intermediate/src/dashboard/FrontPage.jsx` |
| Advanced | `frontend_intermediate/src/dashboard/AdvancedDashboard.jsx` |
| Login | `frontend_intermediate/src/auth/AdminLogin.jsx`, `LoginPage.css` |
| Migration | `database/migration_evaluation_cache.sql` |
| Postman samples | `POSTMAN.md` (request/response bodies for Node + Flask) |

---

## API quick reference

| Method | URL | Purpose |
|--------|-----|---------|
| POST | `http://127.0.0.1:5000/` | Evaluate entity (JSON body) |
| POST | `http://127.0.0.1:5000/rag/reindex` | Rebuild vector index |
| GET | `http://localhost:3000/GetAll` | List entities (+ merged metrics + `last_evaluation`) |
| POST | `http://localhost:3000/add` | Add entity |
| POST | `http://localhost:3000/bulkImport` | Body `{ "rows": [ {...}, ... ] }` — multi-entity + metrics |
| PUT | `http://localhost:3000/UpdateScore` | Update gauge score |
| PUT | `http://localhost:3000/UpdateEvaluation` | Save `evaluation_cache` + score |
| PUT | `http://localhost:3000/entityMetrics` | Save `metrics_json` |
| DELETE | `http://localhost:3000/entity?entity_id=...` | Remove entity (also registered as `DELETE /entity/:entity_id`) |

---

## Environment variables (LLM)

**Where to configure:** create or edit **`llm_intermediate/.env`** (copy from **`llm_intermediate/.env.example`**). Variables are loaded when you start the API with `python llm.py` (uses `python-dotenv`). You can also set the same names in the system environment or your IDE run configuration.

- `OLLAMA_HOST` (default `http://127.0.0.1:11434`)
- `OLLAMA_LLM_MODEL` (default `mistral`)
- `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`)
- `OLLAMA_TIMEOUT_S` (default `300`) — HTTP timeout for Ollama calls (seconds)
- `RAG_AGENTIC` (default `1`) — set `0` to use single-pass retrieval only
- `USE_LLM_JSON` (default `0`) — when `1`, enables an extra Ollama JSON merge when RAG is off (adds latency)

**Startup log** `Startup RAG reindex OK: {..., 'collection': 'credit_risk_knowledge__ollama-nomic-embed-text-768'}` means the index was built with **768-dimensional embeddings from Ollama’s `nomic-embed-text`**. Keep the **Ollama app or `ollama serve`** running while developing if you want real embeddings and LLM JSON; otherwise the stack can fall back to hash embeddings and rule-only narrative.
