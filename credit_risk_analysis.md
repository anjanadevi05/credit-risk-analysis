# Credit risk analysis — project guide

This document explains the **intermediate credit-risk use-case** application: what each part does, how data flows, and how to run optional research tooling.

---

## 1. High-level architecture

The system has **four** main processes:


| Layer               | Technology                        | Role                                                                                                                        |
| ------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**        | React (Vite), Chart.js            | Entity dashboard, risk gauge, factor grid, advanced report UI, CSV import UX                                                |
| **Backend API**     | Node.js, Express, MySQL           | CRUD for entities, `metrics_json`, `evaluation_cache`, scores                                                               |
| **LLM / rules API** | Python, Flask                     | Load dataset + factor rules CSVs, score each factor, build **composite** and **advanced** report, optional **RAG** + Ollama |
| **RAG store**       | Qdrant (local), Ollama embeddings | Vector index over rule text; retrieval to condition LLM JSON for dashboard panels                                           |


**Typical flow**

1. User opens the **Entity Risk Dashboard** (React).
2. Backend serves entities from MySQL (`entities_final_1`), including merged `metrics_json` and cached `evaluation_cache` when present.
3. User clicks **Evaluate** → browser `POST`s entity payload to Flask `**http://127.0.0.1:5000/`** with `use_rag: true` by default.
4. Flask evaluates every factor against `factor_thresholds_evaluator_global-truth.csv`, derives **final bucket** (with reconciliation vs composite and watch-list size), builds **advanced_details**, optionally runs **RAG + Ollama**, returns JSON.
5. Frontend updates the **gauge** using `**advanced_details.composite_score`** (higher = more credit risk), shows the **short** top-level `**summary`** next to the gauge, and persists `**summary**`, `**memorandum_summary**`, and `**advanced_details**` via Node `**UpdateEvaluation**` / `**UpdateScore**`.

---

## 2. Risk scoring semantics (important)

- **Factor rating** (Low / Medium / High): from numeric metrics vs **ranges** in the rules CSV. “High” on a factor means **higher risk** on that dimension (worse covenant / weaker metric), not “high quality.”
- **Composite score (0–100)**: weighted mix — **financial (40%)**, **sector (30%)**, **country (30%)** — from `report_builder.py`. **Higher composite = more risk.**
- **Gauge colours**: after evaluation, the arc and table bar use **final bucket** (Low = green, Medium = amber, High = red), same idea as the gauge summary (“assessed as Medium risk…”). **Un-evaluated** rows use numeric bands (**≤20 / 21–30 / >30**). Advanced **composite** card still shows backend bands (**under 20 / 20–40 / 40+**). Score search filters: **low ≤20**, **medium 21–30**, **high >30**.
- **Final bucket** (Low / Medium / High): rule-based majority plus **reconciliation** so the label is not inconsistent with many High factors, many watch items, or the composite band.

---

## 3. Repository layout (main folders)

- `**frontend_intermediate/`** — React app: `FrontPage` (table, modal, gauge), `AdvancedDashboard` (print-friendly report), utilities (`riskDisplay.js`, `factorLabel.js`, `evaluatePayload.js`).
- `**backend_intermediate/**` — Express routes: `GetAll`, `add`, `bulkImport`, `UpdateScore`, `UpdateEvaluation`, `entityMetrics`, `DELETE /entity` with `entity_id` query (or path variant).
- `**llm_intermediate/**` — Flask `llm.py`, `report_builder.py`, `rag.py`, `results/` (saved `eval_*.json`, metrics logs), `tools/evaluate_summaries.py`.
- `**Dataset/Intermediate-Credit-Risk-UseCase-DataSet/**` — `credit_risk_dataset_50_entities.csv`, `factor_thresholds_evaluator_global-truth.csv`, `sample_single_entity_import.csv`, templates.

---

## 4. Frontend features

### 4.1 Entity dashboard (`FrontPage`)

- **Table**: entity list with score bar, **View** (cached evaluation), **Evaluate** (live Flask call), **Delete** (remove row from DB).
- **Search**: filter by name/id/sector/country, or by field + score keywords (`low` / `medium` / `high` with composite-aligned bands).
- **Gauge**: uses **composite** when available; otherwise a factor fallback (Unknown treated as Medium). The **Risk Assessment Summary** under the gauge is a **short** rule-built paragraph (`gauge_narrative_summary`): overall bucket, comma-separated high/low factor labels, count of Medium factors, then a one-line recommended action (multi-line via `white-space: pre-line`).
- **Factor cards**: human-readable names (e.g. **Governance score** instead of `governance_score_0_100`).
- **Add entity**: after a successful `POST /add` (and optional metrics upload), the UI **reloads the entity list from `GetAll`** so rows are never kept only in React state when the database is the source of truth.
- **Bulk CSV import**: posts rows to Node `bulkImport` (core columns + metrics).

### 4.2 Advanced dashboard

- **Searchable combobox**: type a few characters (e.g. `EN`, `Ve`) → filtered list; click a row to select (single control, not separate search + `<select>`).
- **Generate Risk Report**: same evaluate API; shows composite, investment risk phrase, red-flag list, **memorandum-style** executive summary (full `_fallback_summary` text in `advanced_details.summary`), and panels. There is **no** duplicate “structured snapshot (composite view)” block in the UI.
- **Open saved evaluation**: reads `last_evaluation` from DB without calling Flask.

### 4.3 Environment / payload hygiene

- Evaluate payload strips DB-only fields (e.g. `id` / BigInt) and sends `**use_rag: true`** by default.
- `.env` in `llm_intermediate/` configures Ollama host, models, timeouts (`IMPLEMENTATION.md`).

---

## 5. Backend (Node + MySQL)

- `**entities_final_1**`: stores `entity_id`, name, sector, country, ownership, `score`, `metrics_json`, `evaluation_cache`.
- `**evaluation_cache**`: JSON with `factors`, `summary` (short gauge narrative), `memorandum_summary`, `final_evaluation`, `advanced_details` (including memorandum in `advanced_details.summary`), `final_confidence`, `rag` metadata — used for **View** and Advanced **saved** report.

---

## 6. LLM / rules service (`llm.py`)

- Loads **companies** and **rules** CSVs from the Dataset folder.
- `**resolve_client_data`**: merges dataset row by `entity_id` with request/DB payload.
- `**numeric_for_factor**`: maps rule-book factor names to values, including **text fields** (`auditor_tier` → Big4 code, `financials_audited` → Yes/No code, `covenant_quality` → Strong/Standard/Weak codes, etc.) so imports match the evaluator.
- `**POST /`**: full evaluation + optional RAG; saves artifact under `llm_intermediate/results/`.
- `**POST /rag/reindex**`: rebuilds Qdrant collection from rules (batch scripts also call this).

### 6.1 Narrative style

- **Gauge / main modal** (`gauge_narrative_summary` in `rag.py`): one short block — bucket, primary pressure (High factors as readable metric names), support (Low factors), Medium count, blank line, **Recommended action** line. Exposed as the top-level `**summary`** field on `POST /` and cached in `evaluation_cache.summary`.
- **Advanced executive** (`_fallback_summary` in `rag.py`): longer **credit-memorandum** with `**…**` section labels (**CREDIT MEMORANDUM**, **OBLIGOR CONTEXT**, **PRIMARY PRESSURE POINTS**, **OFFSETTING FACTORS**, **FACTOR DISTRIBUTION**, **RECOMMENDATION**) rendered bold in the Advanced UI. Stored as `advanced_details.summary` and mirrored in `memorandum_summary` on the evaluate response.
- **RAG path**: Ollama JSON may still refine **panel** fields (`financial_capacity`, `sector_risk`, etc.); those merges do not replace the memorandum/gauge split above.
- `**report_builder`**: builds deterministic panel scores and a long internal `summary` string used only inside the builder merge path; `llm.py` overwrites `advanced_details.summary` with the memorandum and does not surface a separate structured snapshot in the Advanced UI.

---

## 7. RAG (`rag.py`)

- Embeddings via **HTTP** to Ollama (`/api/embeddings`) with timeout (avoids indefinite hangs).
- **Retrieve** → **format context** → **chat** JSON for structured dashboard fields.
- `**RAG_AGENTIC`**: optional second retrieval pass on High factors (env `0` to disable).
- **Qdrant collection creation** uses `VectorParams` + `Distance` from `qdrant_client.models`; a missing import causes **startup reindex** to fail with `name 'VectorParams' is not defined`.

---

## 8. Optional: summary metrics (BLEU / ROUGE)

**Not** required to run the app. Used for **research / thesis** reporting.

- Script: `llm_intermediate/tools/evaluate_summaries.py`
- **Without** `references.jsonl`: aggregates **ROUGE-L / BLEU** between **gauge `summary`** and **`memorandum_summary`** across `eval_*.json` (no accuracy/confidence aggregates in the report).
- **With** `llm_intermediate/results/references.jsonl` (JSON lines: `entity_id` without `#`, `reference`): adds **BLEU / ROUGE-L vs gold** per entity.
- Output: `llm_intermediate/results/summary_metrics_report.json`

**How to run**

- Double-click **`run_summary_metrics.bat`** (installs `sacrebleu` / `rouge-score` into the venv and runs the script), **or**
- Manually: activate `llm_intermediate` venv, `pip install sacrebleu rouge-score`, then `python tools/evaluate_summaries.py`

Do **not** add this to the main startup bat as a blocking step — it is slow when many `eval_*.json` files exist.

---

## 9. Sample CSV (bulk import demo row)

- **`frontend_intermediate/public/sample_single_entity_import.csv`**: one full metrics row for **`ENT_ALPINE_MFG`** (Alpine Precision MFG SA — manufacturing / Mexico, moderate leverage and governance) for testing **Import CSV rows** or **`POST /bulkImport`**. See **`POSTMAN.md`** for JSON equivalents (`/add` + `/entityMetrics`).
- A **`#` prefix** on `entity_id` (if you use one) sorts early when lists are sorted lexicographically.

---

## 10. Batch files

- `**start_only.bat` / `setup_and_run.bat`**: Ollama (if on PATH), Flask, reindex, Node backend, React dev server.
- `**run_summary_metrics.bat**`: optional BLEU/ROUGE only.

---

## 11. Further reading

- **`IMPLEMENTATION.md`** — API tables, env vars, troubleshooting (Qdrant, Ollama port, timeouts).
- **`POSTMAN.md`** — Example request/response bodies for Postman (Node `:3000`, Flask `:5000`).

---

*This file is the narrative “what is what” for the project; keep `IMPLEMENTATION.md` for operational command/env reference.*