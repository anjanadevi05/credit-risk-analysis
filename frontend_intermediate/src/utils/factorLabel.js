/** Readable labels for raw CSV / rule factor names. */
const LABEL_MAP = {
  governance_score_0_100: "Governance score",
  auditor_tier_code: "Auditor tier",
  financials_audited_code: "Financials audited",
  country_risk_0_100: "Country risk",
  industry_cyclicality_code: "Industry cyclicality",
  hedging_policy_code: "Hedging policy",
  covenant_quality_code: "Covenant quality",
  sanctions_exposure_code: "Sanctions exposure",
  revenue_cagr_3y_pct: "Revenue CAGR (3y)",
  revenue_usd_m: "Revenue (USD m)",
  ebitda_margin_pct: "EBITDA margin",
  ebit_margin_pct: "EBIT margin",
  debt_to_equity: "Debt to equity",
  interest_coverage: "Interest coverage",
  operating_cf_usd_m: "Operating cash flow (USD m)",
  net_debt_usd_m: "Net debt (USD m)",
  total_assets_usd_m: "Total assets (USD m)",
  equity_usd_m: "Equity (USD m)",
  cash_usd_m: "Cash (USD m)",
  current_ratio: "Current ratio",
  quick_ratio: "Quick ratio",
  dscr: "DSCR",
  dso_days: "DSO (days)",
  dpo_days: "DPO (days)",
  dio_days: "DIO (days)",
  payment_incidents_12m: "Payment incidents (12m)",
  legal_disputes_open: "Legal disputes (open)",
  esg_controversies_3y: "ESG controversies (3y)",
  fx_revenue_pct: "FX revenue %",
  collateral_coverage_pct: "Collateral coverage %",
  years_in_operation: "Years in operation",
  PD_1y_pct: "PD (1y %)",
  LGD_pct: "LGD %",
  EAD_usd_m: "EAD (USD m)",
};

export function formatFactorLabel(raw) {
  if (!raw) return "";
  const stripped = String(raw).replace(/\s*\(.*?\)\s*/g, "").trim();
  const key = stripped.split("(")[0].trim();
  if (LABEL_MAP[key]) return LABEL_MAP[key];
  return stripped
    .replace(/_0_100$/i, "")
    .replace(/_code$/i, "")
    .replace(/_usd_m$/i, " (USD m)")
    .replace(/_pct$/i, " (%)")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
