import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { buildEvaluatePayload } from "../utils/evaluatePayload.js";
import { splitEvaluationLogic } from "../utils/splitEvaluationLogic.js";
import { MemorandumBody } from "../utils/MemorandumBody.jsx";
import { stripGaugeRecommendedAction } from "../utils/gaugeSummaryDisplay.js";
import { getDisplayRiskScore } from "../utils/riskDisplay.js";
import "./AdvancedDashboard.css";

const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const LLM_URL = import.meta.env.VITE_LLM_URL || "http://127.0.0.1:5000";

const AdvancedDashboard = () => {
  const navigate = useNavigate();
  const [entities, setEntities] = useState([]);
  const [entityId, setEntityId] = useState("");
  const [comboInput, setComboInput] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const blurTimer = useRef(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [genError, setGenError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/GetAll`);
        const list = res.data.data || [];
        list.sort((a, b) =>
          String(a.entity_id ?? "").localeCompare(String(b.entity_id ?? ""), undefined, {
            numeric: true,
          })
        );
        setEntities(list);
      } catch (err) {
        console.error("Failed to fetch entities.", err);
      }
    })();
  }, []);

  const selected = useMemo(() => {
    if (entityId) return entities.find((e) => String(e.entity_id) === String(entityId));
    return null;
  }, [entityId, entities]);

  const displayEntityId = (id) => String(id ?? "").replace(/^#/, "");
  const entityLabel = (e) => `${displayEntityId(e.entity_id)} — ${e.entity_name || ""}`;

  const comboMatches = useMemo(() => {
    const q = comboInput.trim().toLowerCase();
    const base = entities.filter((e) => {
      if (!q) return true;
      const blob = [e.entity_id, e.entity_name, e.sector, e.country]
        .filter((x) => x !== undefined && x !== null && x !== "")
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
    return base.slice(0, 50);
  }, [entities, comboInput]);

  useEffect(() => {
    if (!entityId) return;
    const e = entities.find((x) => String(x.entity_id) === String(entityId));
    if (e && !comboOpen) setComboInput(`${e.entity_id} — ${e.entity_name || ""}`);
  }, [entityId, entities, comboOpen]);

  const pickEntity = (e) => {
    setEntityId(e.entity_id);
    setComboInput(entityLabel(e));
    setComboOpen(false);
    setResult(null);
  };

  const onComboFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setComboOpen(true);
  };

  const onComboBlur = () => {
    blurTimer.current = setTimeout(() => setComboOpen(false), 180);
  };

  const onComboChange = (ev) => {
    const v = ev.target.value;
    setComboInput(v);
    setComboOpen(true);
    const cur = entities.find((x) => String(x.entity_id) === String(entityId));
    if (cur && v === entityLabel(cur)) return;
    setEntityId("");
  };

  const evaluateAdvanced = async () => {
    if (!selected) return;
    setLoading(true);
    setGenError(null);
    try {
      const res = await axios.post(
        LLM_URL,
        buildEvaluatePayload(selected),
        { timeout: 600000 }
      );
      const data = res.data || {};
      if (!data.factors?.length) {
        setGenError("API returned no factors — check LLM server (port 5000) and Dataset CSV paths.");
        return;
      }
      if (!data.advanced_details || typeof data.advanced_details !== "object") {
        setGenError("API returned no advanced_details — check LLM server logs for JSON errors.");
        return;
      }
      
      const evaluatedData = { ...selected, ...data };
      setResult(evaluatedData);

      const finalScore = getDisplayRiskScore(evaluatedData);

      // 1. Update Score in Database
      if (finalScore !== undefined && finalScore !== null) {
        try {
          await axios.put(`${API_URL}/UpdateScore`, {
            entity_id: evaluatedData.entity_id,
            score: finalScore,
          });
        } catch (dbError) {
          console.error(`Failed to update score in DB for entity ${evaluatedData.entity_id}:`, dbError);
        }
      }

      // 2. Persist Cache in Database
      const cache = {
        factors: evaluatedData.factors,
        summary: evaluatedData.summary,
        memorandum_summary: evaluatedData.memorandum_summary,
        final_evaluation: evaluatedData.final_evaluation,
        advanced_details: evaluatedData.advanced_details,
        final_confidence: evaluatedData.final_confidence,
        rag: evaluatedData.rag,
      };
      
      try {
        await axios.put(`${API_URL}/UpdateEvaluation`, {
          entity_id: evaluatedData.entity_id,
          score: finalScore,
          evaluation_cache: cache,
        });
      } catch (dbError) {
        console.error("Failed to persist evaluation cache:", dbError);
      }

      // 3. Update local state so Open Saved Evaluation unlocks without reloading the page
      setEntities((prev) =>
        prev.map((e) => {
          if (String(e.entity_id) === String(evaluatedData.entity_id)) {
            return {
              ...e,
              last_evaluation: cache,
              score: finalScore !== undefined && finalScore !== null ? finalScore : e.score
            };
          }
          return e;
        })
      );

    } catch (err) {
      console.error("Error evaluating.", err);
      const msg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "Evaluation failed";
      setGenError(String(msg));
      alert(`Evaluation failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const loadCachedReport = () => {
    const le = selected?.last_evaluation;
    if (!le?.factors?.length) return;
    if (!le.advanced_details || typeof le.advanced_details !== "object") {
      alert(
        "This saved report has no structured panels. Run Evaluate on the main dashboard once to refresh the cache."
      );
      return;
    }
    setGenError(null);
    setResult({
      ...selected,
      factors: le.factors,
      summary: le.summary,
      memorandum_summary: le.memorandum_summary,
      final_evaluation: le.final_evaluation,
      advanced_details: {
        ...le.advanced_details,
        summary:
          le.advanced_details?.summary ||
          le.memorandum_summary ||
          le.summary,
      },
      final_confidence: le.final_confidence,
      rag: le.rag,
    });
  };

  const downloadReport = (format) => {
    if (!result) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "json") {
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `advanced_risk_report_${displayEntityId(result.entity_id)}_${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    window.print();
  };

  const renderPill = (text) => {
    if (!text) return null;
    const lower = String(text).toLowerCase();
    let pillClass = "pill-low";
    if (lower.includes("high")) pillClass = "pill-high";
    else if (lower.includes("medium")) pillClass = "pill-medium";
    return <span className={`risk-pill ${pillClass}`}>{String(text).toUpperCase()}</span>;
  };

  const adv = result?.advanced_details || {};
  const fc = adv.financial_capacity || {};
  const sr = adv.sector_risk || {};
  const cr = adv.country_risk || {};
  const pa = adv.portfolio_analysis || {};
  const composite = adv.composite_score ?? result?.composite_score;
  const compNum = Number(composite);
  const compositeFormula = adv.composite_calculation || "";
  const evalLogic = adv.evaluation_logic || "";
  const evalLogicParagraphs = splitEvaluationLogic(evalLogic);
  /** Single source of truth: backend red_flags_list (deduped). Do not merge raw factor names — they duplicate lines. */
  const redFlagLines = Array.isArray(adv.red_flags_list) ? adv.red_flags_list : [];

  const invPhrase = adv.investment_risk_label;
  const compBand = adv.composite_band;

  const finalEval = result?.final_evaluation;

  return (
    <div className="adv-page">
      <div className="adv-container">
        <div className="control-panel no-print">
          <div className="panel-header">
            <h2>Report Setup</h2>
            <button className="back-btn" onClick={() => navigate("/FrontPage")}>
              Back to Home
            </button>
          </div>
          {genError && (
            <div className="adv-gen-error" role="alert">
              {genError}
            </div>
          )}
          <div className="filters">
            <div className="filter-group adv-entity-picker">
              <label htmlFor="adv-entity-combo">Search and select entity</label>
              <div className="adv-combobox">
                <input
                  id="adv-entity-combo"
                  type="text"
                  className="adv-entity-search"
                  autoComplete="off"
                  placeholder="Type e.g. EN or Vertex — pick from list"
                  value={comboInput}
                  onChange={onComboChange}
                  onFocus={onComboFocus}
                  onBlur={onComboBlur}
                  aria-autocomplete="list"
                  aria-expanded={comboOpen}
                  aria-controls="adv-entity-listbox"
                />
                {comboOpen && (
                  <ul
                    id="adv-entity-listbox"
                    className="adv-combobox-list"
                    role="listbox"
                  >
                    {comboMatches.length === 0 ? (
                      <li className="adv-combobox-empty">No matches</li>
                    ) : (
                      comboMatches.map((e) => (
                        <li key={String(e.entity_id)} role="option">
                          <button
                            type="button"
                            className="adv-combobox-option"
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => pickEntity(e)}
                          >
                            {entityLabel(e)}
                            {e.sector ? (
                              <span className="adv-combobox-meta">
                                {" "}
                                · {e.sector}
                                {e.country ? ` · ${e.country}` : ""}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            </div>
            <div className="adv-actions">
              <button
                type="button"
                className="cache-btn"
                onClick={loadCachedReport}
                disabled={!selected?.last_evaluation?.factors}
                title={
                  selected?.last_evaluation?.factors
                    ? "Show last saved evaluation from database (no API call)"
                    : "Evaluate from the main dashboard first to save a report"
                }
              >
                Open saved evaluation
              </button>
              <button className="generate-btn" onClick={evaluateAdvanced} disabled={loading || !selected}>
                {loading ? "Evaluating..." : "Generate Risk Report"}
              </button>
            </div>
          </div>
        </div>

        {result && (
          <div className="report-canvas print-section">
            <div className="report-title">
              <span className="adv-emoji-inline" aria-hidden>
                📋
              </span>
              <span className="report-title-text">Risk Assessment Results</span>
            </div>

            <div className="entity-block">
              <div className="entity-indicator" />
              <div className="entity-info">
                <h3>
                  {displayEntityId(result.entity_id)} — {result.entity_name}
                </h3>
                <p>
                  {result.sector || "—"} • {result.country || "—"} •{" "}
                  {result.revenue_usd_m != null && result.revenue_usd_m !== ""
                    ? `$${Number(result.revenue_usd_m).toFixed(0)}M Revenue`
                    : fc.revenue || "Revenue not on file"}
                </p>
              </div>
            </div>

            <div className="core-metrics-grid">
              <div className="core-card">
                <span className="core-label">Final Risk Rating</span>
                <div className="core-value-large">
                  {finalEval ? (
                    renderPill(`${String(finalEval).toUpperCase()} RISK`)
                  ) : (
                    <span className="risk-pill pill-medium">PENDING</span>
                  )}
                </div>
                <span className="core-subtext">Comprehensive Assessment</span>
              </div>
              <div className="core-card">
                <span className="core-label">Composite Score</span>
                <div className="core-value-large score-blue">
                  {Number.isFinite(compNum) ? compNum.toFixed(1) : "—"}
                </div>
              </div>
              <div className="core-card">
                <span className="core-label">Investment Risk</span>
                <div className="core-value-large inv-risk-text">
                  {invPhrase || "—"}
                </div>
              </div>
              <div className="core-card">
                <span className="core-label">Red Flags</span>
                <div className="core-value-large score-blue">{redFlagLines.length}</div>
                <span className="core-subtext">Unique watch items</span>
              </div>
            </div>

            <div className="summary-block risk-assessment-summary-block">
              <h4><strong>Risk Assessment Summary</strong></h4>
              <p className="summary-body adv-summary-preline adv-risk-gauge-narrative">
                {stripGaugeRecommendedAction(result.summary) ||
                  "Run Generate Risk Report after evaluating on the main dashboard to populate the short gauge narrative here."}
              </p>
            </div>

            <div className="summary-block">
              <div className="summary-body adv-memo-prose">
                <MemorandumBody
                  text={
                    adv.summary ||
                    result.memorandum_summary ||
                    "No memorandum in this result — run Generate Risk Report or open a saved evaluation."
                  }
                />
              </div>
            </div>

            <div className="panels-row">
              <div className="risk-panel border-blue">
                <div className="panel-hdr">
                  <h4>
                    <span className="adv-emoji-inline" aria-hidden>
                      💰
                    </span>{" "}
                    Financial Capacity
                  </h4>
                </div>
                <div className="panel-score-row">
                  <span>Risk Score: {fc.numeric_score ?? "—"}</span>
                  {renderPill(fc.risk_rating)}
                </div>
                <div className="panel-body">
                  <p>
                    <strong>Classification:</strong> {fc.classification || "—"}
                  </p>
                  <p>
                    <strong>Revenue:</strong> {fc.revenue || "—"}
                  </p>
                  <p>
                    <strong>Rationale:</strong> {fc.rationale || "—"}
                  </p>
                </div>
              </div>

              <div className="risk-panel border-blue">
                <div className="panel-hdr">
                  <h4>
                    <span className="adv-emoji-inline" aria-hidden>
                      🏭
                    </span>{" "}
                    Sector Risk
                  </h4>
                </div>
                <div className="panel-score-row">
                  <span>Risk Score: {sr.numeric_score ?? "—"}</span>
                  {renderPill(sr.risk_rating)}
                </div>
                <div className="panel-body">
                  <p>
                    <strong>Sector:</strong> {sr.sector || "—"}
                  </p>
                  <p>
                    <strong>Analysis:</strong> {sr.analysis || "—"}
                  </p>
                </div>
              </div>

              <div className="risk-panel border-blue">
                <div className="panel-hdr">
                  <h4>
                    <span className="adv-emoji-inline" aria-hidden>
                      🌍
                    </span>{" "}
                    Country Risk
                  </h4>
                </div>
                <div className="panel-score-row">
                  <span>Risk Score: {cr.numeric_score ?? "—"}</span>
                  {renderPill(cr.risk_rating)}
                </div>
                <div className="panel-body">
                  <p>
                    <strong>Country:</strong> {cr.country || "—"}
                  </p>
                  <p>
                    <strong>Analysis:</strong> {cr.analysis || "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="portfolio-row">
              <div className="risk-panel border-blue min-width-300">
                <div className="panel-hdr">
                  <h4>
                    <span className="adv-emoji-inline" aria-hidden>
                      💼
                    </span>{" "}
                    Portfolio Analysis
                  </h4>
                </div>
                <div className="panel-body">
                  <p>
                    <strong>Holdings:</strong> {pa.holdings ?? "—"}
                  </p>
                  <p>
                    <strong>Max Concentration:</strong> {pa.max_concentration ?? "—"}
                  </p>
                  <p>
                    <strong>Top-3 Concentration:</strong> {pa.top_3_concentration ?? "—"}
                  </p>
                  <p>
                    <strong>Illiquid Holdings:</strong> {pa.illiquid_holdings ?? "—"}
                  </p>
                  <p>
                    <strong>Related Party:</strong> {pa.related_party ?? "—"}
                  </p>
                </div>
              </div>
            </div>

            {redFlagLines.length > 0 && (
              <div className="assessment-box red-flags-box">
                <h4 className="box-title text-red">
                  <span className="adv-emoji-inline" aria-hidden>
                    🚨
                  </span>{" "}
                  Red Flags Detected ({redFlagLines.length})
                </h4>
                <div className="flags-list">
                  {redFlagLines.map((text, i) => (
                    <div key={`${text}-${i}`} className="flag-item-solid">
                      ⚠️ {text}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="assessment-box justification-box">
              <h4 className="box-title">
                <span className="adv-emoji-inline" aria-hidden>
                  📋
                </span>{" "}
                Complete Assessment Justification
              </h4>
              <div className="justification-row">
                <strong>Composite Score Calculation:</strong>
                <p>
                  {compositeFormula ||
                    "Weighted blend of financial (40%), sector (30%), and country (30%) scores."}
                </p>
              </div>
              <div className="justification-row">
                <strong>Final Evaluation Logic:</strong>
                <div className="eval-logic-blocks">
                  {evalLogicParagraphs.length > 0
                    ? evalLogicParagraphs.map((para, i) => (
                        <p key={i} className="eval-logic-para">
                          {para}
                        </p>
                      ))
                    : (
                        <p>
                          {evalLogic ||
                            `Bucket: ${String(finalEval ?? "—")} from factor rules and covenant overrides.`}
                        </p>
                      )}
                </div>
              </div>
              <div className="justification-row">
                <strong>Risk Weights Applied:</strong>
                <p>Financial Capacity (40%) + Sector Risk (30%) + Country Risk (30%)</p>
              </div>
              <div className="justification-row">
                <strong>Regulatory Compliance:</strong>
                <p>
                  Basel III capital adequacy, IFRS 9 expected credit loss, MiFID II suitability assessment
                </p>
              </div>
            </div>

            <div className="bot-action-bar no-print">
              <h4>
                <span className="adv-emoji-inline" aria-hidden>
                  📄
                </span>{" "}
                Download Assessment Reports
              </h4>
              <div className="btn-group">
                <button className="dl-btn green-btn" onClick={() => downloadReport("json")}>
                  📊 Download JSON Report
                </button>
                <button className="dl-btn green-btn" onClick={() => downloadReport("pdf")}>
                  📋 Print / Save PDF
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export { AdvancedDashboard };
