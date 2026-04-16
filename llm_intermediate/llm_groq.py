import os

_LLM_DIR = os.path.dirname(os.path.abspath(__file__))
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(_LLM_DIR, ".env"))
except ImportError:
    pass

from flask import Flask, request, jsonify
from flask_cors import CORS
import math
import pandas as pd
import json
import re
import threading
import time

# IMPORT RAG_GROQ INSTEAD OF RAG FOR DEPLOYMENT!
from rag_groq import build_index_from_rules, rag_summary, _fallback_summary, gauge_narrative_summary
from report_builder import (
    build_advanced_report,
    collect_red_flags_list,
    merge_llm_advanced,
    preview_composite,
    reconcile_final_bucket,
)

app = Flask(__name__)
# Enable CORS for the deployed frontend
# Set CORS to point to specific frontend domain in actual production
CORS(app)

RESULTS_DIR = os.path.join(_LLM_DIR, "results")


def _save_evaluation_artifact(entity_id: object, payload: dict) -> None:
    """Persist each evaluate response under llm_intermediate/results (like coverage artifacts)."""
    try:
        os.makedirs(RESULTS_DIR, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        safe = re.sub(r"[^\w\-.]", "_", str(entity_id or "unknown"))[:80]
        fname = f"eval_{safe}_{ts}.json"
        path = os.path.join(RESULTS_DIR, fname)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        log_path = os.path.join(RESULTS_DIR, "metrics_log.jsonl")
        adv = payload.get("advanced_details") or {}
        line = {
            "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "entity_id": entity_id,
            "composite_score": adv.get("composite_score"),
            "final_evaluation": payload.get("final_evaluation"),
            "final_confidence": payload.get("final_confidence"),
            "rag_enabled": (payload.get("rag") or {}).get("enabled"),
            "rag_retrieved": (payload.get("rag") or {}).get("retrieved"),
            "rag_agentic": (payload.get("rag") or {}).get("agentic"),
            "report_file": fname,
        }
        with open(log_path, "a", encoding="utf-8") as lf:
            lf.write(json.dumps(line, ensure_ascii=False) + "\n")
    except OSError as exc:
        print(f"Could not write results artifact: {exc}")


def _clean_value(v):
    try:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
    except TypeError:
        pass
    return v


def _to_json_serializable(obj):
    """Flask jsonify cannot encode numpy scalars / NaN — normalize for stable API responses."""
    if obj is None:
        return None
    if isinstance(obj, (str, bool)):
        return obj
    if isinstance(obj, int) and not isinstance(obj, bool):
        return int(obj)
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, dict):
        return {str(k): _to_json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_json_serializable(x) for x in obj]
    if hasattr(obj, "item"):
        try:
            return _to_json_serializable(obj.item())
        except Exception:
            pass
    return str(obj)


def _plain_summary_text(s: str) -> str:
    """Strip markdown emphasis for the main dashboard summary line."""
    if not s or not isinstance(s, str):
        return s
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    t = re.sub(r"__(.+?)__", r"\1", t)
    return t.strip()


def normalize_client_data(client_data: dict) -> None:
    if client_data.get("sanctions_exposure_code") is None:
        se = str(client_data.get("sanctions_exposure", "")).lower()
        client_data["sanctions_exposure_code"] = 2 if se in ("2", "high", "severe", "yes") else 0


COLUMN_ALIASES_TO_CANONICAL = {
    "revenue_usd": "revenue_usd_m",
    "ebitda_margin": "ebitda_margin_pct",
    "ebit_margin": "ebit_margin_pct",
    "total_assets": "total_assets_usd_m",
    "net_debt": "net_debt_usd_m",
    "interest_expense": "interest_expense_usd_m",
    "operating_cash_flow": "operating_cf_usd_m",
    "operating_cf": "operating_cf_usd_m",
    "fcf": "fcf_usd_m",
    "capex": "capex_usd_m",
    "cash_usd": "cash_usd_m",
    "equity_usd": "equity_usd_m",
    "days_receivable": "dso_days",
    "days_payable": "dpo_days",
    "days_inventory": "dio_days",
    "revenue_growth_rate": "revenue_cagr_3y_pct",
    "revenue_cagr": "revenue_cagr_3y_pct",
    "PD_pct": "PD_1y_pct",
    "pd_pct": "PD_1y_pct",
    "EAD_usd": "EAD_usd_m",
    "ead_usd": "EAD_usd_m",
    "liquidity_ratio": "quick_ratio",
    "hedging_strategy": "hedging_policy",
}


def apply_column_aliases(client_data: dict) -> None:
    for alt, canon in COLUMN_ALIASES_TO_CANONICAL.items():
        if alt not in client_data:
            continue
        v = client_data.get(alt)
        if v is None or v == "":
            continue
        if client_data.get(canon) is None or client_data.get(canon) == "":
            client_data[canon] = v


def _infer_industry_cyclicality_code(client_data: dict) -> None:
    icc = client_data.get("industry_cyclicality_code")
    if icc is not None and str(icc).strip() != "":
        return
    raw = client_data.get("industry_cyclicality") or client_data.get("industry_risk")
    if raw is None or raw == "":
        return
    s = str(raw).lower()
    if "high" in s or "volatile" in s:
        client_data["industry_cyclicality_code"] = 2
    elif "medium" in s or "competitive" in s or "moderate" in s:
        client_data["industry_cyclicality_code"] = 1
    elif "low" in s or "stable" in s or "regulated" in s:
        client_data["industry_cyclicality_code"] = 0


def _infer_hedging_policy_code(client_data: dict) -> None:
    hpc = client_data.get("hedging_policy_code")
    if hpc is not None and str(hpc).strip() != "":
        return
    raw = client_data.get("hedging_policy") or client_data.get("hedging_strategy")
    if raw is None or raw == "":
        return
    s = str(raw).lower()
    if "comprehens" in s or "strong" in s or "full" in s:
        client_data["hedging_policy_code"] = 2
    elif "partial" in s:
        client_data["hedging_policy_code"] = 1
    else:
        client_data["hedging_policy_code"] = 0


def _infer_governance_score(client_data: dict) -> None:
    if client_data.get("governance_score_0_100") is not None and str(client_data.get("governance_score_0_100")).strip() != "":
        return
    g = str(client_data.get("governance_risk", "")).lower()
    if not g:
        return
    if "high" in g or "severe" in g:
        client_data["governance_score_0_100"] = 55.0
    elif "medium" in g:
        client_data["governance_score_0_100"] = 68.0
    elif "low" in g:
        client_data["governance_score_0_100"] = 82.0


def _infer_country_risk_numeric(client_data: dict) -> None:
    if client_data.get("country_risk_0_100") is not None and str(client_data.get("country_risk_0_100")).strip() != "":
        return
    c = str(client_data.get("country_risk", "")).lower()
    if not c:
        return
    if "high" in c or "severe" in c:
        client_data["country_risk_0_100"] = 75.0
    elif "medium" in c:
        client_data["country_risk_0_100"] = 35.0
    elif "low" in c:
        client_data["country_risk_0_100"] = 12.0


def _entity_id_match_variants(entity_id) -> list:
    """CSV may use #ENT or ENT; API may send either."""
    if entity_id is None:
        return []
    s = str(entity_id).strip()
    if not s:
        return []
    out = [s]
    if s.startswith("#"):
        out.append(s[1:])
    else:
        out.append("#" + s)
    seen = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def resolve_client_data(data: dict) -> dict:
    """Merge CSV row (if any) with request body so DB-only entities + metrics_json work."""
    payload = {k: v for k, v in data.items() if k != "use_rag" and k != "use_fast"}
    entity_id = payload.get("entity_id")

    in_csv = False
    matched_csv_id = None
    col = None
    if entity_id is not None and not df_companies.empty and "entity_id" in df_companies.columns:
        col = df_companies["entity_id"].astype(str)
        for key in _entity_id_match_variants(entity_id):
            if col.eq(key).any():
                in_csv = True
                matched_csv_id = key
                break

    if entity_id is not None and in_csv:
        row = df_companies[col == matched_csv_id].iloc[0].to_dict()
        base = {k: _clean_value(v) for k, v in row.items()}
        for k, v in payload.items():
            if k == "entity_id":
                continue
            if v is not None and v != "":
                base[k] = v
        client_data = base
    else:
        client_data = dict(payload)

    normalize_client_data(client_data)
    eid = client_data.get("entity_id")
    if eid is not None and str(eid).strip() != "":
        s = str(eid).strip()
        client_data["entity_id"] = s[1:] if s.startswith("#") else s
    return client_data


def numeric_for_factor(client_data: dict, factor: str) -> float:
    """Resolve rule-book factor names to numeric inputs (CSV uses short names like auditor_tier, not full factor keys)."""
    fn = str(factor).strip()

    def _f(key: str, default: float = 0.0) -> float:
        v = client_data.get(key)
        if v is None or v == "":
            return default
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    if "auditor_tier_code" in fn:
        if client_data.get("auditor_tier_code") not in (None, ""):
            return _f("auditor_tier_code", 0.0)
        aud = str(client_data.get("auditor_tier", "")).lower().replace(" ", "")
        return 1.0 if "big4" in aud or aud in ("big4", "b4") else 0.0

    if "financials_audited_code" in fn:
        if client_data.get("financials_audited_code") not in (None, ""):
            return _f("financials_audited_code", 0.0)
        fa = str(client_data.get("financials_audited", "")).lower()
        return 1.0 if fa in ("yes", "true", "1", "y") else 0.0

    if "industry_cyclicality_code" in fn:
        if client_data.get("industry_cyclicality_code") not in (None, ""):
            return _f("industry_cyclicality_code", 0.0)
        raw = str(client_data.get("industry_cyclicality", "")).lower()
        if "high" in raw or raw.strip() == "2":
            return 2.0
        if "medium" in raw or raw.strip() == "1":
            return 1.0
        return 0.0

    if "hedging_policy_code" in fn:
        if client_data.get("hedging_policy_code") not in (None, ""):
            return _f("hedging_policy_code", 0.0)
        raw = str(client_data.get("hedging_policy", "")).lower()
        if "comprehens" in raw or "strong" in raw or "full" in raw:
            return 2.0
        if "partial" in raw:
            return 1.0
        return 0.0

    if "covenant_quality_code" in fn:
        if client_data.get("covenant_quality_code") not in (None, ""):
            return _f("covenant_quality_code", 0.0)
        raw = str(client_data.get("covenant_quality", "")).lower()
        if "strong" in raw:
            return 2.0
        if "standard" in raw or "moderate" in raw:
            return 1.0
        return 0.0

    if "sanctions_exposure_code" in fn:
        if client_data.get("sanctions_exposure_code") not in (None, ""):
            return _f("sanctions_exposure_code", 0.0)
        raw = str(client_data.get("sanctions_exposure", "")).lower()
        if "direct" in raw or raw.strip() == "2":
            return 2.0
        if "indirect" in raw or raw.strip() == "1":
            return 1.0
        return 0.0

    v = client_data.get(factor, 0)
    if v is None or v == "":
        v = 0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# Step 1: Load CSVs
try:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    companies_path = os.path.join(
        base_dir,
        "Dataset",
        "Intermediate-Credit-Risk-UseCase-DataSet",
        "credit_risk_dataset_50_entities.csv",
    )
    rules_path = os.path.join(
        base_dir,
        "Dataset",
        "Intermediate-Credit-Risk-UseCase-DataSet",
        "factor_thresholds_evaluator_global-truth.csv",
    )

    df_companies = pd.read_csv(companies_path)
    df_rules = pd.read_csv(rules_path)
except FileNotFoundError as e:
    print(f"Error loading CSV: {e}")
    df_companies = pd.DataFrame()
    df_rules = pd.DataFrame()


def evaluate_factor(factor_name, value):
    """Skip rules rows with empty/NaN ranges (CSV Medium placeholders); avoids TypeError on compare."""
    rules = df_rules[df_rules["factor"] == factor_name]
    try:
        v = float(value)
    except (TypeError, ValueError):
        v = 0.0
    for _, row in rules.iterrows():
        sr, er = row["start_range"], row["end_range"]
        if pd.isna(sr) or pd.isna(er):
            continue
        try:
            lo, hi = float(sr), float(er)
        except (TypeError, ValueError):
            continue
        if lo <= v <= hi:
            return row["evaluation"]
    return "Unknown"


def compute_final_evaluation(factor_evals, client_data):
    red_flags = (
        client_data.get("dscr", 0) < 1.0
        or client_data.get("interest_coverage", 0) < 1.5
        or client_data.get("current_ratio", 0) < 0.8
        or client_data.get("sanctions_exposure_code", 0) == 2
        or client_data.get("payment_incidents_12m", 0) >= 3
    )
    if red_flags:
        return "High"

    high_count = sum(1 for v in factor_evals.values() if v == "High")
    low_count = sum(1 for v in factor_evals.values() if v == "Low")

    if high_count > low_count:
        return "High"
    if low_count > high_count:
        return "Low"
    return "Medium"


@app.route("/js")
def home():
    return "Credit Risk Evaluation Deployment API is running. Use POST / to evaluate entities."


@app.route("/test")
def test():
    return jsonify({"message": "Deployment Test route works with Groq!"})


@app.route("/rag/reindex", methods=["POST"])
def rag_reindex():
    if df_rules.empty:
        return jsonify({"ok": False, "error": "Rules CSV not loaded"}), 500
    try:
        rules_rows = df_rules.to_dict(orient="records")
        result = build_index_from_rules(rules_rows)
        return jsonify(result)
    except Exception as e:
        import traceback

        return jsonify({"ok": False, "error": str(e), "trace": traceback.format_exc()}), 500


@app.route("/", methods=["POST"])
def evaluate():
    try:
        return _evaluate_core()
    except Exception as exc:
        import traceback

        return (
            jsonify(
                {
                    "error": str(exc),
                    "detail": "Unhandled exception in / evaluate — see server log.",
                    "trace": traceback.format_exc(),
                }
            ),
            500,
        )


def _evaluate_core():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No input provided"}), 400

    use_rag = True
    if isinstance(data, dict) and "use_rag" in data:
        use_rag = bool(data.get("use_rag"))
        data = {k: v for k, v in data.items() if k != "use_rag"}

    if df_rules.empty:
        return jsonify({"error": "Rules CSV not loaded"}), 500

    client_data = resolve_client_data(data if isinstance(data, dict) else {})
    apply_column_aliases(client_data)
    _infer_industry_cyclicality_code(client_data)
    _infer_hedging_policy_code(client_data)
    _infer_governance_score(client_data)
    _infer_country_risk_numeric(client_data)

    factor_evals = {}
    factor_output = []
    factor_conf_scores = []

    for factor in df_rules["factor"].unique():
        val = numeric_for_factor(client_data, factor)
        predicted = evaluate_factor(factor, val)
        expected = predicted
        acc = 100 if predicted == expected else 0
        if predicted == expected and predicted != "Unknown":
            conf = 1.0
        elif predicted != "Unknown":
            conf = 0.5
        else:
            conf = 0.0
        factor_conf_scores.append(conf)
        factor_output.append(
            {
                "factor": factor,
                "evaluation": predicted,
                "expected": expected,
                "accuracy_%": acc,
                "confidence": round(conf, 2),
            }
        )
        factor_evals[factor] = predicted

    red_list = collect_red_flags_list(client_data, factor_evals)
    preliminary = compute_final_evaluation(factor_evals, client_data)
    composite_preview = preview_composite(factor_evals, client_data)
    final_eval = reconcile_final_bucket(
        factor_evals, composite_preview, preliminary, watch_item_count=len(red_list)
    )
    expected_final_eval = preliminary
    final_acc = 100 if final_eval == expected_final_eval else 0
    final_confidence = (
        round(sum(factor_conf_scores) / len(factor_conf_scores), 2) if factor_conf_scores else 0.0
    )

    advanced_details = build_advanced_report(
        client_data, factor_evals, final_eval, red_flags_precomputed=red_list
    )
    rag_sources = []
    rag_retrieved = 0
    rag_agentic = False

    if use_rag:
        try:
            rag = rag_summary(factor_evals=factor_evals, final_evaluation=final_eval)
            rag_sources = rag["sources"]
            rag_retrieved = rag["retrieved"]
            rag_agentic = bool(rag.get("agentic"))
            raw = rag["summary"]
            if isinstance(raw, dict):
                parsed = raw
            else:
                try:
                    parsed = json.loads(str(raw))
                except json.JSONDecodeError:
                    parsed = None
            if isinstance(parsed, dict):
                advanced_details = merge_llm_advanced(advanced_details, parsed)
        except Exception:
            use_rag = False

    use_llm_json = os.getenv("USE_LLM_JSON", "0").strip().lower() in ("1", "true", "yes")
    if not use_rag and use_llm_json:
        prompt = f"""You are a credit risk analyst. Output valid JSON only.
Evaluated factors (Low/Medium/High):
{json.dumps(factor_evals, indent=2)}
Final evaluation: {final_eval}
Entity context: sector={client_data.get("sector")}, country={client_data.get("country")}, revenue_usd_m={client_data.get("revenue_usd_m")}

Return JSON with keys: summary (string, 4-6 sentences), financial_capacity, sector_risk, country_risk, portfolio_analysis (same shape as a risk dashboard).
"""
        try:
            from groq import Groq
            groq_api_key = os.getenv("GROQ_API_KEY")
            if groq_api_key:
                client = Groq(api_key=groq_api_key)
                completion = client.chat.completions.create(
                    messages=[{"role": "user", "content": prompt}],
                    model="llama3-8b-8192",
                    temperature=0.2,
                    max_tokens=800,
                    response_format={"type": "json_object"},
                )
                parsed = json.loads(completion.choices[0].message.content)
                advanced_details = merge_llm_advanced(advanced_details, parsed)
        except Exception as e:
            print(f"Deployment Groq Fallback error: {e}")
            pass

    out_adv = {k: v for k, v in advanced_details.items() if not k.startswith("_")}
    # Memorandum keeps **bold** markers for Advanced dashboard rendering (gauge text still plain).
    memorandum = _fallback_summary(factor_evals, final_eval, client_data).strip()
    gauge_text = _plain_summary_text(
        gauge_narrative_summary(factor_evals, final_eval, client_data)
    )
    out_adv.pop("structured_summary", None)
    out_adv["summary"] = memorandum

    output = {
        "entity_id": client_data.get("entity_id"),
        "factors": factor_output,
        "summary": gauge_text,
        "memorandum_summary": memorandum,
        "advanced_details": out_adv,
        "rag": {
            "enabled": use_rag,
            "retrieved": rag_retrieved,
            "sources": rag_sources,
            "agentic": rag_agentic if use_rag else False,
        },
        "final_evaluation": final_eval,
        "final_eval_expected": expected_final_eval,
        "final_eval_accuracy_%": final_acc,
        "final_confidence": final_confidence,
    }
    safe_out = _to_json_serializable(output)
    _save_evaluation_artifact(client_data.get("entity_id"), safe_out)
    return jsonify(safe_out)


def _startup_reindex_background():
    """Rebuild vector index after the server is up so batch scripts are not the only trigger."""

    def job():
        time.sleep(2.5)
        if df_rules.empty:
            print("Startup reindex skipped: rules CSV not loaded.")
            return
        try:
            rules_rows = df_rules.to_dict(orient="records")
            result = build_index_from_rules(rules_rows)
            print(f"Startup Groq RAG reindex OK: {result}")
        except Exception as exc:
            print(f"Startup Groq RAG reindex failed: {exc}")

    threading.Thread(target=job, daemon=True).start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    _startup_reindex_background()
    # In deployment, disable debug and listen on all interfaces
    app.run(host="0.0.0.0", port=port, debug=False)
