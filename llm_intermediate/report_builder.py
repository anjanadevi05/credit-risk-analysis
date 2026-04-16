"""Deterministic advanced report fields from entity data + factor evaluations."""
from __future__ import annotations

from typing import Any, Dict, List


def _num(x: Any, default: float | None = None) -> float | None:
    try:
        if x is None or x == "":
            return default
        return float(x)
    except (TypeError, ValueError):
        return default


def _pill_from_score(score: float) -> str:
    if score >= 55:
        return "HIGH RISK"
    if score >= 35:
        return "MEDIUM RISK"
    return "LOW RISK"


def preview_composite(factor_evals: Dict[str, Any], client_data: Dict[str, Any]) -> float:
    fin_score = _avg_factor_risk(factor_evals)
    sec_score = _sector_score(client_data)
    ctry_score = _country_score(client_data)
    return fin_score * 0.40 + sec_score * 0.30 + ctry_score * 0.30


def composite_band(composite: float) -> str:
    """0–100 composite: higher = more risk. Bands align narrative with score."""
    if composite >= 40:
        return "High"
    if composite >= 20:
        return "Medium"
    return "Low"


def investment_risk_phrase(composite: float) -> str:
    if composite >= 40:
        return "Elevated investment risk"
    if composite >= 20:
        return "Moderate investment risk"
    return "Lower investment risk"


def reconcile_final_bucket(
    factor_evals: Dict[str, Any],
    composite: float,
    preliminary: str,
    *,
    watch_item_count: int = 0,
) -> str:
    """
    Avoid contradictory labels (e.g. overall Low with many High-rated factors, many watch items, or medium composite).
    """
    high_n = sum(1 for v in factor_evals.values() if v == "High")
    comp = composite_band(composite)
    order = {"Low": 0, "Medium": 1, "High": 2}

    def mx(a: str, b: str) -> str:
        return a if order.get(a, 0) >= order.get(b, 0) else b

    out = preliminary
    if high_n >= 5:
        out = mx(out, "Medium")
    if high_n >= 8:
        out = mx(out, "High")
    # Unique watch items (structural alerts + one line per High factor) — many ⇒ elevate bucket
    if watch_item_count >= 8:
        out = mx(out, "High")
    elif watch_item_count >= 5:
        out = mx(out, "Medium")
    out = mx(out, comp)
    return out


def _avg_factor_risk(factor_evals: Dict[str, Any]) -> float:
    vals: List[float] = []
    for v in factor_evals.values():
        s = str(v).lower()
        if s == "high":
            vals.append(75.0)
        elif s == "medium":
            vals.append(50.0)
        elif s == "low":
            vals.append(25.0)
    return sum(vals) / len(vals) if vals else 40.0


def _sector_score(client_data: Dict[str, Any]) -> float:
    c = str(client_data.get("industry_cyclicality", "")).lower()
    if "high" in c:
        return 40.0
    if "medium" in c:
        return 28.0
    return 18.0


def _country_score(client_data: Dict[str, Any]) -> float:
    cr = _num(client_data.get("country_risk_0_100"), None)
    if cr is not None:
        return max(0.0, min(100.0, cr))
    return 35.0


def _revenue_tier(rev: float | None) -> tuple[str, str]:
    if rev is None:
        return "Unknown", "Revenue not provided — import metrics CSV or use dataset entity."
    # USD millions — illustrative bands (not regulatory definitions)
    if rev < 50:
        return "Micro cap (<$50M revenue)", f"Revenue ${rev:.0f}M is in the micro band (<$50M)."
    if rev < 300:
        return "Small cap ($50M–$300M)", f"Revenue ${rev:.0f}M is in the small-cap band."
    if rev < 1000:
        return "Mid-market ($300M–$1B)", f"Revenue ${rev:.0f}M is mid-market scale ($300M–$1B)."
    if rev < 5000:
        return "Upper mid-market / large ($1B–$5B)", f"Revenue ${rev:.0f}M sits in the large mid-market band."
    return "Large corporation (>$5B)", f"Revenue ${rev:.0f}M indicates very large-scale capacity."


FACTOR_RED_FLAG_HINTS: Dict[str, str] = {
    "revenue_cagr_3y_pct": "Low or negative growth weakens visibility on future cash flows and covenant headroom.",
    "auditor_tier_code": "Non–Big-4 or weaker audit tier can reduce confidence in reported numbers and disclosures.",
    "quick_ratio": "Tight quick liquidity limits ability to cover short-term obligations without inventory reliance.",
    "current_ratio": "Compressed working-capital cushion raises short-term liquidity risk if collections slip.",
    "dscr": "Debt service coverage near or below policy tests refinancing and stress risk.",
    "interest_coverage": "Thin interest cover leaves little room for earnings or rate shocks.",
    "net_debt_usd_m": "Elevated leverage versus peers increases default sensitivity.",
    "debt_to_equity": "High leverage skews the capital structure toward creditor risk.",
    "payment_incidents_12m": "Recent payment friction signals operational or liquidity stress.",
    "governance_score_0_100": "Governance score in the stressed band warrants board and control review.",
    "esg_controversies_3y": "ESG incidents can affect franchise, funding costs, and stakeholder risk.",
    "country_risk_0_100": "Country risk index is elevated versus investment-grade comfort zones.",
}


def _high_factor_line(fname: str) -> str:
    base_key = str(fname).split("(")[0].strip()
    label = (
        fname.replace("(Other=0, Big4=1)", "auditor tier")
        .replace("(No=0, Yes=1)", "audited")
        .replace("(None=0, Indirect=1, Direct=2)", "sanctions")
        .replace("_", " ")
        .strip()
    )
    hint = FACTOR_RED_FLAG_HINTS.get(base_key) or FACTOR_RED_FLAG_HINTS.get(fname)
    if hint:
        return f"{label} — {hint}"
    return f"{label} — Rated High vs. policy bands; review underlying drivers and covenants."


def collect_red_flags_list(client_data: Dict[str, Any], factor_evals: Dict[str, Any]) -> List[str]:
    """Structural alerts + one line per High factor (deduped by factor key). Same list as advanced report."""
    red_flags: List[str] = []
    if _num(client_data.get("dscr"), 99) is not None and _num(client_data.get("dscr"), 99) < 1.0:
        red_flags.append("DSCR below 1.0 — debt service may be stressed vs. cash generation.")
    if _num(client_data.get("interest_coverage"), 99) is not None and _num(client_data.get("interest_coverage"), 99) < 1.5:
        red_flags.append("Interest coverage below 1.5× — limited cushion for rate or earnings shocks.")
    if int(float(_num(client_data.get("payment_incidents_12m"), 0) or 0)) >= 3:
        red_flags.append("Elevated payment incidents (12m) — operational or liquidity strain signal.")
    code = client_data.get("sanctions_exposure_code")
    try:
        if int(float(code or 0)) == 2:
            red_flags.append("Sanctions exposure flagged — compliance / exit risk.")
    except (TypeError, ValueError):
        pass

    seen_factor_keys: set[str] = set()
    for fname, ev in factor_evals.items():
        if str(ev) != "High":
            continue
        key = str(fname).split("(")[0].strip()
        if key in seen_factor_keys:
            continue
        seen_factor_keys.add(key)
        red_flags.append(_high_factor_line(fname))
    return red_flags[:22]


def _portfolio_block(client_data: Dict[str, Any]) -> Dict[str, str]:
    ead = _num(client_data.get("EAD_usd_m"))
    pd = _num(client_data.get("PD_1y_pct"), 0) or 0
    lgd = _num(client_data.get("LGD_pct"), 0) or 0
    if ead is None:
        return {
            "holdings": "N/A",
            "max_concentration": "N/A",
            "top_3_concentration": "N/A",
            "illiquid_holdings": "N/A",
            "related_party": "N/A",
        }
    est_max = min(45.0, pd * 4 + 10)
    est_top3 = min(85.0, est_max * 2.2)
    illiq = min(80.0, lgd * 0.9 + 15)
    rel = min(35.0, pd * 2)
    return {
        "holdings": "1 facility (modeled)",
        "max_concentration": f"{est_max:.1f}%",
        "top_3_concentration": f"{est_top3:.1f}%",
        "illiquid_holdings": f"{illiq:.1f}%",
        "related_party": f"{rel:.1f}%",
    }


def build_advanced_report(
    client_data: Dict[str, Any],
    factor_evals: Dict[str, Any],
    final_eval: str,
    red_flags_precomputed: List[str] | None = None,
) -> Dict[str, Any]:
    fin_score = _avg_factor_risk(factor_evals)
    sec_score = _sector_score(client_data)
    ctry_score = _country_score(client_data)
    composite = fin_score * 0.40 + sec_score * 0.30 + ctry_score * 0.30
    formula = (
        f"({fin_score:.1f} × 0.40) + ({sec_score:.1f} × 0.30) + ({ctry_score:.1f} × 0.30) = {composite:.1f}"
    )

    rev = _num(client_data.get("revenue_usd_m"))
    tier, rev_rationale = _revenue_tier(rev)
    sector = str(client_data.get("sector") or "Not specified").strip()
    country = str(client_data.get("country") or "Not specified").strip()

    fin_pill = _pill_from_score(fin_score)
    sec_pill = _pill_from_score(sec_score)
    ctry_pill = _pill_from_score(ctry_score)

    red_flags = (
        list(red_flags_precomputed) if red_flags_precomputed is not None else collect_red_flags_list(client_data, factor_evals)
    )

    band = composite_band(composite)
    inv_phrase = investment_risk_phrase(composite)
    eval_logic_parts = [
        f"Composite risk score {composite:.1f} (band: {band}) from weighted financial ({fin_score:.1f}), sector ({sec_score:.1f}), and country ({ctry_score:.1f}). "
        f"Interpretation: under 20 = lower relative risk, 20–40 = moderate, 40+ = elevated.",
        f"Final bucket {final_eval} reconciles factor majority, covenant stress, composite band, unique watch-list size, and concentration of High-rated factors.",
    ]
    if red_flags:
        eval_logic_parts.append(
            f"Unique watch items: {len(red_flags)} (structural alerts plus one line per High-rated factor, deduplicated)."
        )

    high_factor_n = sum(1 for v in factor_evals.values() if str(v).lower() == "high")
    med_factor_n = sum(1 for v in factor_evals.values() if str(v).lower() == "medium")
    # Dashboard summary: plain language only (no markdown; formula lives in composite_calculation).
    summary_text = (
        f"CREDIT VIEW — Assigned bucket {final_eval.upper()} with composite risk index {composite:.1f}/100 ({band} band; higher = more risk). "
        f"Investment posture: {inv_phrase}. Capacity: {fin_pill} at {tier}. "
        f"Sector read ({sector}): {sec_pill}. Jurisdiction ({country}): {ctry_pill}.\n\n"
        f"Factor mix: {high_factor_n} High, {med_factor_n} Medium under the rule engine. "
        f"Watch items ({len(red_flags)}): {', '.join(red_flags[:5]) if red_flags else 'none material in automated liquidity / covenant checks'}"
        f"{'; further items omitted for brevity.' if len(red_flags) > 5 else ''}\n\n"
        "RECOMMENDATION — Document limits and tenor consistent with the bucket; escalate reporting frequency if Medium-rated factors trend toward High; "
        "for Low bucket, maintain standard review cadence unless covenants or payment behaviour deteriorate."
    )

    return {
        "summary": summary_text,
        "financial_capacity": {
            "risk_rating": fin_pill,
            "numeric_score": round(fin_score, 1),
            "classification": tier,
            "revenue": f"${rev:.0f}M" if rev is not None else "Not provided",
            "rationale": rev_rationale,
        },
        "sector_risk": {
            "risk_rating": sec_pill,
            "numeric_score": round(sec_score, 1),
            "sector": sector,
            "analysis": (
                f"Industry cyclicality: {client_data.get('industry_cyclicality', 'n/a')}. "
                f"Sector stress is proxied at {sec_score:.0f}/100 for scoring."
            ),
        },
        "country_risk": {
            "risk_rating": ctry_pill,
            "numeric_score": round(ctry_score, 1),
            "country": f"{country} (sovereign risk index {ctry_score:.0f}/100)",
            "analysis": (
                f"Jurisdiction {country}: sovereign / transfer-risk index {ctry_score:.0f}/100 "
                "in the composite scoring model."
            ),
        },
        "portfolio_analysis": _portfolio_block(client_data),
        "composite_score": round(composite, 1),
        "composite_band": band,
        "composite_calculation": formula,
        "investment_risk_label": inv_phrase,
        "evaluation_logic": " ".join(eval_logic_parts),
        "red_flags_list": red_flags,
    }


def merge_llm_advanced(base: Dict[str, Any], llm: Any) -> Dict[str, Any]:
    if not isinstance(llm, dict):
        return base
    out = dict(base)
    # Do not merge LLM "summary" here — top-level narrative is rule-based + readable (see llm.py).
    for key in ("financial_capacity", "sector_risk", "country_risk", "portfolio_analysis"):
        if isinstance(llm.get(key), dict) and isinstance(base.get(key), dict):
            merged = {**base[key], **llm[key]}
            for nk in ("numeric_score",):
                if nk in base[key] and nk not in llm[key]:
                    merged[nk] = base[key][nk]
            out[key] = merged
    return out
