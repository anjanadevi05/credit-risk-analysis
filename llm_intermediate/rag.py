from __future__ import annotations

import hashlib
import logging
import os
import shutil
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

DEFAULT_COLLECTION_BASE = "credit_risk_knowledge"

_CACHED_SIGNATURE: Optional[str] = None


def _factor_base_key(name: str) -> str:
    return str(name).split("(")[0].strip()


# Short memorandum phrases (High = risk pressure, Low = supportive)
_HIGH_PRESSURE_PHRASES: Dict[str, str] = {
    "governance_score_0_100": "a weak governance score on the 0–100 scale",
    "auditor_tier_code": "lower-tier external audit quality (non–Big-Four or equivalent)",
    "financials_audited_code": "limited assurance on audited financial statements",
    "fx_revenue_pct": "material foreign-exchange revenue exposure",
    "country_risk_0_100": "an elevated sovereign / transfer-risk index",
    "industry_cyclicality_code": "above-average industry cyclicality",
    "hedging_policy_code": "limited or no hedging of currency or rate risk",
    "covenant_quality_code": "weak or loosely structured covenant protection",
    "collateral_coverage_pct": "thin collateral coverage relative to exposure",
    "payment_incidents_12m": "recent payment friction or delinquency signals",
    "legal_disputes_open": "a heavier load of open legal disputes",
    "sanctions_exposure_code": "sanctions or compliance exposure",
    "esg_controversies_3y": "repeat ESG or controversy events",
    "revenue_usd_m": "small-scale revenue relative to policy thresholds",
    "revenue_cagr_3y_pct": "weak or negative revenue growth momentum",
    "quick_ratio": "tight quick liquidity",
    "current_ratio": "compressed working-capital liquidity",
    "dscr": "debt service coverage under stress versus policy comfort",
    "interest_coverage": "thin interest coverage headroom",
    "debt_to_equity": "elevated financial leverage",
    "ebit_margin_pct": "weak EBIT margin versus policy bands",
    "ebitda_margin_pct": "weak EBITDA margin versus policy bands",
    "net_debt_usd_m": "high absolute net debt",
    "years_in_operation": "limited operating history",
}

_LOW_SUPPORT_PHRASES: Dict[str, str] = {
    "dscr": "comfortable debt service coverage",
    "interest_coverage": "solid interest coverage headroom",
    "debt_to_equity": "conservative leverage versus equity",
    "current_ratio": "adequate working-capital liquidity",
    "quick_ratio": "healthy quick liquidity",
    "governance_score_0_100": "a strong governance score on the 0–100 scale",
    "auditor_tier_code": "Big-Four (or equivalent) audit quality",
    "country_risk_0_100": "a benign country-risk profile",
    "revenue_usd_m": "large-scale revenue capacity",
    "revenue_cagr_3y_pct": "healthy revenue growth trajectory",
    "fx_revenue_pct": "limited FX revenue concentration",
    "hedging_policy_code": "comprehensive hedging policy",
    "covenant_quality_code": "strong covenant structuring",
    "collateral_coverage_pct": "robust collateral coverage",
    "payment_incidents_12m": "clean recent payment record",
    "ebitda_margin_pct": "healthy EBITDA margins",
    "ebit_margin_pct": "healthy EBIT margins",
}


def _humanize_factor(name: str) -> str:
    cleaned = (
        name.replace("(Other=0, Big4=1)", "")
        .replace("(No=0, Yes=1)", "")
        .replace("(None=0, Indirect=1, Direct=2)", "")
        .replace("(Low=0, Medium=1, High=2)", "")
        .replace("(Weak=0, Standard=1, Strong=2)", "")
        .replace("(None=0, Partial=1, Comprehensive=2)", "")
        .replace("_", " ")
        .strip()
    )
    return " ".join(cleaned.split())


def _phrase_for_factor_high(fname: str) -> str:
    key = _factor_base_key(fname)
    return _HIGH_PRESSURE_PHRASES.get(key, f"pressure in {_humanize_factor(fname).lower()}")


def _phrase_for_factor_low(fname: str) -> str:
    key = _factor_base_key(fname)
    return _LOW_SUPPORT_PHRASES.get(key, f"support from {_humanize_factor(fname).lower()}")


def _entity_dateline(client_data: Optional[Dict[str, Any]]) -> str:
    if not client_data:
        return "Obligor details were not fully specified in the request payload."
    name = str(client_data.get("entity_name") or "the obligor").strip()
    country = str(client_data.get("country") or "").strip()
    sector = str(client_data.get("sector") or "").strip()
    rev = client_data.get("revenue_usd_m")
    parts = [name]
    if sector:
        parts.append(f"({sector})")
    if country:
        parts.append(f"in {country}")
    line = " ".join(parts).replace(" )", ")")
    if rev is not None and str(rev).strip() != "":
        try:
            line += f", with reported revenue of approximately ${float(rev):,.1f}M USD"
        except (TypeError, ValueError):
            line += f", with reported revenue context {rev}"
    return line + "."


def _tailored_recommendation(
    final_evaluation: str,
    high_keys: List[str],
    medium_count: int,
) -> str:
    bucket = str(final_evaluation).strip().lower()
    bits: List[str] = []
    if "governance" in " ".join(high_keys) or any("governance" in k for k in high_keys):
        bits.append("tighten governance and board reporting requirements")
    if any("fx" in k or "hedging" in k for k in high_keys):
        bits.append("step up FX and hedging monitoring with quarterly management certificates")
    if any("auditor" in k or "financials_audited" in k for k in high_keys):
        bits.append("request enhanced assurance or auditor engagement letter where policy allows")
    if any("covenant" in k or "dscr" in k or "interest_coverage" in k for k in high_keys):
        bits.append("increase covenant testing frequency and cash-flow verification")

    if bucket == "high":
        core = (
            "Given the High bucket, reduce or stage incremental exposure until mitigants are evidenced; "
            "require monthly covenant and liquidity reporting on the weakest drivers."
        )
    elif bucket == "medium":
        core = (
            "Given the Medium bucket, maintain exposure within approved limits but require quarterly "
            "covenant and risk reporting, with escalation if any High-rated factor deteriorates further."
        )
    else:
        core = (
            "Given the Low bucket, annual review is appropriate unless payment behaviour, covenants, "
            "or macro factors breach early-warning triggers."
        )

    extra = ""
    if bits:
        extra = " Specifically: " + "; ".join(bits) + "."
    if medium_count >= 5 and bucket != "high":
        extra += (
            f" With {medium_count} Medium-rated drivers, watch for migration into High bands on the next review cycle."
        )
    return core + extra


def _fallback_summary(
    factor_evals: Dict[str, Any],
    final_evaluation: str,
    client_data: Optional[Dict[str, Any]] = None,
) -> str:
    high_factors = [k for k, v in factor_evals.items() if str(v).lower() == "high"]
    low_factors = [k for k, v in factor_evals.items() if str(v).lower() == "low"]
    high_count = len(high_factors)
    medium_count = sum(1 for v in factor_evals.values() if str(v).lower() == "medium")

    risks = [_phrase_for_factor_high(k) for k in high_factors[:5]]
    supports = [_phrase_for_factor_low(k) for k in low_factors[:5]]

    key_risks = "; ".join(risks) if risks else "no dominant single-factor breaches of automated policy bands"
    key_supports = "; ".join(supports) if supports else "limited offsetting strengths in the automated factor set"

    bucket = str(final_evaluation).strip().upper()
    entity_line = _entity_dateline(client_data)
    high_key_bases = [_factor_base_key(k) for k in high_factors]

    return (
        f"**CREDIT MEMORANDUM (automated rule engine)** — Overall risk grade: {bucket}. "
        f"This assessment applies internal threshold tables to financial, structural, and policy factors; "
        f"it is illustrative and not a substitute for committee-approved credit paper.\n\n"
        f"**OBLIGOR CONTEXT**\n{entity_line}\n\n"
        f"**PRIMARY PRESSURE POINTS**\n{key_risks}.\n\n"
        f"**OFFSETTING FACTORS**\n{key_supports}.\n\n"
        f"**FACTOR DISTRIBUTION**\n{high_count} rated High and {medium_count} rated Medium under the current rulebook.\n\n"
        f"**RECOMMENDATION**\n{_tailored_recommendation(final_evaluation, high_key_bases, medium_count)}"
    )


_GAUGE_METRIC_LABELS: Dict[str, str] = {
    "governance_score_0_100": "governance score (0–100 scale)",
    "country_risk_0_100": "country risk (0–100 scale)",
    "auditor_tier_code": "auditor tier",
    "financials_audited_code": "audited financials (code)",
    "industry_cyclicality_code": "industry cyclicality",
    "hedging_policy_code": "hedging policy",
    "covenant_quality_code": "covenant quality",
    "sanctions_exposure_code": "sanctions exposure",
    "payment_incidents_12m": "payment incidents (12m)",
    "legal_disputes_open": "open legal disputes",
    "esg_controversies_3y": "ESG controversies (3y)",
    "revenue_usd_m": "revenue (USD m)",
    "revenue_cagr_3y_pct": "revenue CAGR (3y)",
    "ebitda_margin_pct": "EBITDA margin %",
    "ebit_margin_pct": "EBIT margin %",
    "net_debt_usd_m": "net debt (USD m)",
    "fx_revenue_pct": "FX revenue %",
    "collateral_coverage_pct": "collateral coverage %",
    "dscr": "DSCR",
    "interest_coverage": "interest coverage",
    "debt_to_equity": "debt to equity",
    "current_ratio": "current ratio",
    "quick_ratio": "quick ratio",
    "years_in_operation": "years in operation",
}


def _gauge_metric_label(fname: str) -> str:
    key = _factor_base_key(fname)
    return _GAUGE_METRIC_LABELS.get(key, _humanize_factor(fname).lower())


def gauge_narrative_summary(
    factor_evals: Dict[str, Any],
    final_evaluation: str,
    client_data: Optional[Dict[str, Any]] = None,
) -> str:
    """Short paragraph for the main-dashboard gauge (legacy one-block style)."""
    prefix = ""
    if client_data:
        name = str(client_data.get("entity_name") or "").strip()
        if name:
            prefix = f"For {name}, "
    high = [k for k, v in factor_evals.items() if str(v).lower() == "high"]
    low = [k for k, v in factor_evals.items() if str(v).lower() == "low"]
    med_n = sum(1 for v in factor_evals.values() if str(v).lower() == "medium")
    risk_names = [_gauge_metric_label(k) for k in high[:8]]
    support_names = [_gauge_metric_label(k) for k in low[:8]]
    risks = (
        ", ".join(risk_names)
        if risk_names
        else "no dominant high-severity factor hits in the automated set"
    )
    strengths = (
        ", ".join(support_names)
        if support_names
        else "limited offsetting strengths in the low-rated factor set"
    )
    fe = str(final_evaluation).strip()
    if med_n == 1:
        med_line = "There is 1 medium-risk indicator that should be monitored for directional change."
    else:
        med_line = (
            f"There are {med_n} medium-risk indicators that should be monitored for directional change."
        )
    return (
        f"{prefix}Overall credit profile is assessed as {fe} risk based on the current threshold evaluation. "
        f"Primary risk pressure is driven by {risks}, while relative support is visible in {strengths}. "
        f"{med_line}\n\n"
        "Recommended action: keep current exposure stance but tighten monitoring on the highest-risk factors."
    )


def _stable_id(*parts: str) -> str:
    h = hashlib.sha256("||".join(parts).encode("utf-8")).hexdigest()
    return h[:32]


def _get_persist_dir() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "vector_store")


def _hash_embed(text: str, dim: int = 512) -> List[float]:
    vec = [0.0] * dim
    for tok in text.lower().split():
        idx = hash(tok) % dim
        vec[idx] += 1.0
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


def _ollama_embed_one(prompt: str) -> List[float]:
    model = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
    host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    timeout_s = float(os.getenv("OLLAMA_TIMEOUT_S", "120"))
    with httpx.Client(timeout=timeout_s) as client:
        r = client.post(f"{host}/api/embeddings", json={"model": model, "prompt": prompt})
        r.raise_for_status()
        data = r.json()
        emb = data.get("embedding")
        if not isinstance(emb, list):
            raise ValueError("no embedding in response")
        return [float(x) for x in emb]


def _embed_texts(texts: List[str]) -> List[List[float]]:
    sig = _embedder_signature()
    if sig.startswith("hash-"):
        return [_hash_embed(t) for t in texts]

    vectors: List[List[float]] = []
    for t in texts:
        vectors.append(_ollama_embed_one(t))
    return vectors


def _resolved_collection_name(collection_name: Optional[str]) -> str:
    base = (collection_name or DEFAULT_COLLECTION_BASE).strip() or DEFAULT_COLLECTION_BASE
    if collection_name and collection_name != DEFAULT_COLLECTION_BASE:
        return base

    sig = _embedder_signature()
    embed_id = sig.replace(":", "_").replace("/", "_").replace(" ", "_")
    return f"{DEFAULT_COLLECTION_BASE}__{embed_id}"


def _embedder_signature() -> str:
    global _CACHED_SIGNATURE
    if _CACHED_SIGNATURE:
        return _CACHED_SIGNATURE

    model = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
    try:
        emb = _ollama_embed_one("probe")
        dim = len(emb)
        _CACHED_SIGNATURE = f"ollama-{model}-{dim}"
    except Exception:
        _CACHED_SIGNATURE = "hash-512"
    return _CACHED_SIGNATURE


def _get_client() -> QdrantClient:
    path = _get_persist_dir()
    try:
        return QdrantClient(path=path)
    except Exception as e:
        logging.warning("Qdrant local store failed to load (%s); resetting %s", e, path)
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            os.makedirs(path, exist_ok=True)
        except OSError:
            pass
        return QdrantClient(path=path)


@dataclass(frozen=True)
class RetrievedChunk:
    id: str
    text: str
    metadata: Dict[str, Any]
    distance: float


def build_index_from_rules(
    rules_rows: Iterable[Dict[str, Any]],
    collection_name: str = DEFAULT_COLLECTION_BASE,
) -> Dict[str, Any]:
    documents: List[str] = []
    metadatas: List[Dict[str, Any]] = []
    ids: List[str] = []

    for row in rules_rows:
        factor = str(row.get("factor", "")).strip()
        start = row.get("start_range", "")
        end = row.get("end_range", "")
        evaluation = str(row.get("evaluation", "")).strip()

        text = (
            f"Credit risk rule.\n"
            f"Factor: {factor}\n"
            f"Range: {start} to {end}\n"
            f"Evaluation: {evaluation}\n"
        )
        doc_id = _stable_id("rule", factor, str(start), str(end), evaluation)

        documents.append(text)
        metadatas.append(
            {
                "type": "rule",
                "factor": factor,
                "start_range": start,
                "end_range": end,
                "evaluation": evaluation,
            }
        )
        ids.append(doc_id)

    if not documents:
        return {"ok": False, "added": 0, "reason": "No rules provided"}

    resolved = _resolved_collection_name(collection_name)
    embeddings = _embed_texts(documents)

    client = _get_client()
    client.recreate_collection(
        collection_name=resolved,
        vectors_config=VectorParams(size=len(embeddings[0]), distance=Distance.COSINE),
    )

    points: List[PointStruct] = []
    for i in range(len(documents)):
        payload = {"text": documents[i], "metadata": metadatas[i]}
        points.append(PointStruct(id=ids[i], vector=embeddings[i], payload=payload))

    client.upsert(collection_name=resolved, points=points)
    return {"ok": True, "added": len(documents), "collection": resolved}


def retrieve(
    query: str,
    k: int = 6,
    collection_name: str = DEFAULT_COLLECTION_BASE,
) -> List[RetrievedChunk]:
    try:
        q_emb = _embed_texts([query])[0]
    except Exception as exc:
        logging.warning("retrieve: embedding failed (%s); returning no chunks", exc)
        return []
    client = _get_client()
    resolved = _resolved_collection_name(collection_name)

    out: List[RetrievedChunk] = []
    hits = client.search(collection_name=resolved, query_vector=q_emb, limit=k, with_payload=True)
    for h in hits:
        payload = h.payload or {}
        text = str(payload.get("text", ""))
        meta = payload.get("metadata") or {}
        out.append(
            RetrievedChunk(
                id=str(h.id),
                text=text,
                metadata=meta,
                distance=float(h.score),
            )
        )
    return out


def format_context(chunks: List[RetrievedChunk]) -> Tuple[str, List[Dict[str, Any]]]:
    sources: List[Dict[str, Any]] = []
    lines: List[str] = []
    for idx, c in enumerate(chunks, start=1):
        sources.append(
            {
                "rank": idx,
                "id": c.id,
                "distance": c.distance,
                "metadata": c.metadata,
                "excerpt": c.text[:240],
            }
        )
        lines.append(f"[S{idx}] {c.text.strip()}")
    return ("\n\n".join(lines).strip(), sources)


def _agentic_retrieve(
    factor_evals: Dict[str, Any],
    final_evaluation: str,
    k: int,
    collection_name: str,
) -> Tuple[List[RetrievedChunk], List[RetrievedChunk]]:
    query1 = (
        "Summarize credit risk based on evaluated factors and rules.\n"
        f"Final evaluation: {final_evaluation}\n"
        f"Factors: {factor_evals}\n"
        "Retrieve the most relevant threshold/rule guidance."
    )
    chunks1 = retrieve(query=query1, k=k, collection_name=collection_name)

    high_factors = [fn for fn, ev in factor_evals.items() if str(ev).lower() == "high"][:10]
    query2 = (
        "Credit risk threshold rules for stressed metrics: "
        + ", ".join(_humanize_factor(f) for f in high_factors)
        if high_factors
        else "Credit risk liquidity leverage covenant threshold rules"
    )
    chunks2 = retrieve(query=query2, k=max(4, k // 2 + 2), collection_name=collection_name)

    seen: set[str] = set()
    merged: List[RetrievedChunk] = []
    for c in chunks1 + chunks2:
        if c.id in seen:
            continue
        seen.add(c.id)
        merged.append(c)
    return chunks1, merged[: k + 4]


def rag_summary(
    *,
    factor_evals: Dict[str, Any],
    final_evaluation: str,
    k: int = 6,
    llm_model: Optional[str] = None,
    collection_name: str = DEFAULT_COLLECTION_BASE,
    agentic: Optional[bool] = None,
) -> Dict[str, Any]:
    llm_model = llm_model or os.getenv("OLLAMA_LLM_MODEL", "mistral")

    if agentic is None:
        agentic = os.getenv("RAG_AGENTIC", "1").strip().lower() not in ("0", "false", "no", "off")

    if agentic:
        _, chunks = _agentic_retrieve(factor_evals, final_evaluation, k, collection_name)
    else:
        query = (
            "Summarize credit risk based on evaluated factors and rules.\n"
            f"Final evaluation: {final_evaluation}\n"
            f"Factors: {factor_evals}\n"
            "Retrieve the most relevant threshold/rule guidance."
        )
        chunks = retrieve(query=query, k=k, collection_name=collection_name)

    context, sources = format_context(chunks)

    prompt = f"""
You are a senior credit officer drafting an internal bank-style credit memorandum excerpt for a risk dashboard.

Tone: formal, concise, like a committee memo — no marketing language, no exclamation points.
Use ONLY the retrieved context (sources) plus the evaluated factors. Do not invent obligor-specific facts not implied by the data.

Evaluated factors (Low/Medium/High):
{factor_evals}

Final evaluation bucket:
{final_evaluation}

Retrieved sources:
{context if context else "(no sources retrieved)"}

Your FINAL output MUST BE valid JSON only, matching exactly this structure. Write "summary" and each "analysis"/"rationale" in memorandum prose (short paragraphs, banker terminology: liquidity, leverage, coverage, covenants, tail risks).
{{
  "summary": "3-5 sentences: overall credit view, key vulnerabilities, mitigants, and monitoring stance.",
  "financial_capacity": {{
    "risk_rating": "HIGH RISK" or "MEDIUM RISK" or "LOW RISK",
    "classification": "Scale / entity type label (e.g. Large corporate, Mid-market)",
    "revenue": "Revenue context if inferable, else 'Not specified in data'",
    "rationale": "1-2 sentences: earnings, leverage, coverage, liquidity — memo style."
  }},
  "sector_risk": {{
    "risk_rating": "HIGH RISK" or "MEDIUM RISK" or "LOW RISK",
    "sector": "Sector name if known from context",
    "analysis": "1-2 sentences: cyclicality, competitive or regulatory stress — memo style."
  }},
  "country_risk": {{
    "risk_rating": "HIGH RISK" or "MEDIUM RISK" or "LOW RISK",
    "country": "Jurisdiction line if inferable",
    "analysis": "1-2 sentences: transfer/sovereign or operating environment — memo style."
  }},
  "portfolio_analysis": {{
    "holdings": "Narrative or numeric placeholder consistent with dashboard",
    "max_concentration": "XX.X%",
    "top_3_concentration": "XX.X%",
    "illiquid_holdings": "XX.X%",
    "related_party": "X.X%"
  }}
}}
If portfolio figures are not in the data, generate plausible placeholder percentages for UI only, labelled implicitly as indicative.
"""

    host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    timeout_s = float(os.getenv("OLLAMA_TIMEOUT_S", "300"))
    try:
        with httpx.Client(timeout=timeout_s) as client:
            r = client.post(
                f"{host}/api/chat",
                json={
                    "model": llm_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0.15, "num_predict": 400},
                },
            )
            r.raise_for_status()
            summary = r.json()["message"]["content"]
    except Exception:
        summary = _fallback_summary(factor_evals, final_evaluation, None)
    return {
        "summary": summary,
        "sources": sources,
        "retrieved": len(chunks),
        "agentic": bool(agentic),
    }
