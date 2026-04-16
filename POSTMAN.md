# Postman / API testing — Credit Risk Analysis

Base URLs (default local dev):

| Service | Base |
|--------|------|
| **Node backend** | `http://localhost:3000` |
| **Python LLM / rules** | `http://127.0.0.1:5000` |

Headers: `Content-Type: application/json` for JSON bodies.

**Entity IDs:** use **no `#` prefix** (e.g. `ENT_ALPINE_MFG`). The API normalizes and matches legacy `#ENT…` rows on update/delete.

---

## Node backend (`:3000`)

### 1. `GET /GetAll`

**Response** `200`

```json
{
  "data": [
    {
      "entity_id": "ENT001",
      "entity_name": "Example Corp",
      "sector": "Technology",
      "country": "India",
      "ownership_type": "Private",
      "score": 35.2,
      "metrics_json": null,
      "last_evaluation": null
    }
  ]
}
```

Each row merges parsed `metrics_json` and `last_evaluation` (from `evaluation_cache`) into the object when present.

---

### 2. `POST /add` — single entity (identity only)

**Body**

```json
{
  "entity_id": "ENT_POSTMAN_ACME",
  "entity_name": "Acme River Components Ltd",
  "sector": "Industrials",
  "country": "Germany",
  "ownership_type": "Private"
}
```

**Response** `200`

```json
{
  "message": "Record inserted successfully",
  "insertedId": 0
}
```

**Error** `500` — duplicate `entity_id` or DB error.

Then use **`PUT /entityMetrics`** (below) to attach financial fields.

---

### 3. `PUT /entityMetrics` — metrics for one entity

**Body** (minimal example; add any columns your rules CSV expects)

```json
{
  "entity_id": "ENT_POSTMAN_ACME",
  "metrics": {
    "revenue_usd_m": 420,
    "ebitda_margin_pct": 14.5,
    "ebit_margin_pct": 9.2,
    "debt_to_equity": 0.65,
    "current_ratio": 1.8,
    "quick_ratio": 1.1,
    "dscr": 2.1,
    "interest_coverage": 5.5,
    "governance_score_0_100": 72,
    "country_risk_0_100": 35,
    "industry_cyclicality": "Medium",
    "auditor_tier": "Big4",
    "financials_audited": "Yes",
    "hedging_policy": "Partial",
    "covenant_quality": "Standard",
    "payment_incidents_12m": 0,
    "legal_disputes_open": 0,
    "sanctions_exposure": "None",
    "fx_revenue_pct": 22
  }
}
```

**Response** `200`

```json
{
  "success": true,
  "entity_id": "ENT_POSTMAN_ACME"
}
```

**Error** `404` — unknown `entity_id`.  
**Error** `400` — missing `entity_id` or `metrics`.

Known metric keys are also written to **scalar table columns** when the column exists (see `controller.js`).

---

### 4. `POST /bulkImport` — many entities + metrics

**Body**

```json
{
  "rows": [
    {
      "entity_id": "ENT_BULK_POSTMAN_1",
      "entity_name": "Nordic Wind Services AS",
      "sector": "Utilities",
      "country": "Norway",
      "ownership_type": "Public",
      "revenue_usd_m": 890,
      "ebitda_margin_pct": 28,
      "current_ratio": 1.4,
      "governance_score_0_100": 80,
      "country_risk_0_100": 18
    }
  ]
}
```

**Response** `200`

```json
{
  "imported": 1,
  "failed": 0,
  "errors": [],
  "total": 1
}
```

---

### 5. `PUT /UpdateScore`

**Body**

```json
{
  "entity_id": "ENT_POSTMAN_ACME",
  "score": 42
}
```

**Response** `200` — `{ "success": true, "entity_id": "...", "score": 42 }`  
**Error** `404` — entity not found.

---

### 6. `PUT /UpdateEvaluation` — cache last evaluate result

**Body** (shape matches Flask evaluate response subset)

```json
{
  "entity_id": "ENT_POSTMAN_ACME",
  "score": 38,
  "evaluation_cache": {
    "factors": [],
    "summary": "Short gauge narrative…",
    "memorandum_summary": "**CREDIT MEMORANDUM** …",
    "final_evaluation": "Medium",
    "advanced_details": {},
    "final_confidence": 0.85,
    "rag": { "enabled": true, "retrieved": 4, "sources": [], "agentic": true }
  }
}
```

**Response** `200` — `{ "success": true, "entity_id": "..." }`

---

### 7. `DELETE /entity?entity_id=...`

**Request** `DELETE`  
`http://localhost:3000/entity?entity_id=ENT_POSTMAN_ACME`

Handlers are mounted on **`index.js`** (not only the router) so Express 5 always matches. **Restart Node** after pulling changes.

Also accepts `DELETE /entity/ENT_POSTMAN_ACME` or body `{"entity_id":"..."}`.  
Server tries **with and without** a leading `#` on the id.

**Response** `200` — `{ "success": true, "entity_id": "ENT_POSTMAN_ACME" }`  
**Error** `404` — no row matched.

---

## Python LLM API (`:5000`)

### 8. `POST /` — full evaluation

**Body** — send a full entity payload (merged DB row + metrics). Minimum useful shape:

```json
{
  "entity_id": "ENT_POSTMAN_ACME",
  "entity_name": "Acme River Components Ltd",
  "sector": "Industrials",
  "country": "Germany",
  "ownership_type": "Private",
  "revenue_usd_m": 420,
  "ebitda_margin_pct": 14.5,
  "ebit_margin_pct": 9.2,
  "debt_to_equity": 0.65,
  "current_ratio": 1.8,
  "quick_ratio": 1.1,
  "dscr": 2.1,
  "interest_coverage": 5.5,
  "governance_score_0_100": 72,
  "country_risk_0_100": 35,
  "use_rag": true
}
```

Strip DB-only fields (`id` as BigInt) if you paste from MySQL exports.

**Response** `200` — large JSON including:

- `factors` — array of `{ factor, evaluation, expected, … }`
- `summary` — short **gauge** narrative (plain text)
- `memorandum_summary` — long memorandum with `**bold**` section markers
- `advanced_details` — panels, `composite_score`, `composite_band`, red flags, etc.
- `final_evaluation` — `Low` | `Medium` | `High`
- `rag` — `{ enabled, retrieved, sources, agentic }`

---

### 9. `POST /rag/reindex`

**Body** — optional `{}`  
**Response** `200` — JSON with collection name / point counts (exact shape depends on `rag.py`).

**Error** `500` — rules CSV missing, Qdrant error, or embedding failure.

---

## CSV files (browser / Postman companion)

| File | Use |
|------|-----|
| `frontend_intermediate/public/sample_single_entity_import.csv` | One full metrics row for bulk-style import testing |
| `frontend_intermediate/public/entity_metrics_template.csv` | Header-only template for Add Entity → metrics CSV |

---

## Logo (favicon)

- **Black background:** The original asset was exported with an **opaque black** backdrop; browsers show that as-is.
- **Fix:** Run from repo root (after `pip install pillow`):

  `python tools/make_logo_transparent.py frontend_intermediate/public/logo.png asset/logo.png`

  This flood-fills **connected** near-black pixels from the image corners to **transparent** (works when the frame is black and the subject is lighter).

See also **`IMPLEMENTATION.md`** for env vars and troubleshooting.
