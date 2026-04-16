/**
 * Credit risk index: higher = more risk (aligned with backend composite_score 0–100).
 */

export function getCompositeScore(entity) {
  const adv = entity?.advanced_details || entity?.last_evaluation?.advanced_details;
  const raw = adv?.composite_score;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Fallback when composite not yet loaded: average factor severity (Unknown treated as Medium). */
export function getFactorFallbackScore(entity) {
  if (!entity?.factors?.length) return null;
  const vals = entity.factors.map((f) => {
    switch (String(f.evaluation || "").toLowerCase()) {
      case "low":
        return 0;
      case "medium":
        return 0.5;
      case "high":
        return 1;
      default:
        return 0.5;
    }
  });
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
}

/** Single score for gauge, table, and DB persistence after evaluate. */
export function getDisplayRiskScore(entity) {
  const c = getCompositeScore(entity);
  if (c != null) return c;
  const fb = getFactorFallbackScore(entity);
  if (fb != null) return fb;
  const s = entity?.score;
  if (s !== undefined && s !== null && s !== "") {
    const n = Number(s);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

/** Numeric-only bands when there is no final bucket yet (≤20 / 21–30 / &gt;30). */
export function riskScoreColor(score) {
  if (score === null || score === undefined) return "#e5e7eb";
  if (score <= 20) return "#10b981";
  if (score <= 30) return "#f59e0b";
  return "#ef4444";
}

/** Final risk label from evaluation (matches gauge narrative: "…assessed as Medium risk…"). */
export function getFinalRiskBucket(entity) {
  const raw =
    entity?.final_evaluation ??
    entity?.last_evaluation?.final_evaluation ??
    null;
  if (raw == null || raw === "") return null;
  return String(raw).trim().toLowerCase();
}

export function riskColorForFinalBucket(bucket) {
  switch (bucket) {
    case "low":
      return "#10b981";
    case "medium":
      return "#f59e0b";
    case "high":
      return "#ef4444";
    default:
      return null;
  }
}

/** Prefer Low/Medium/High colour when evaluated; else numeric composite bands. */
export function entityGaugeFillColor(entity) {
  const byBucket = riskColorForFinalBucket(getFinalRiskBucket(entity) || "");
  if (byBucket) return byBucket;
  return riskScoreColor(getDisplayRiskScore(entity));
}

export function buildGaugeData(entity) {
  const score = getDisplayRiskScore(entity);
  if (score == null) {
    if (!entity?.factors?.length) return null;
  }
  const s = score ?? 0;
  const color = entityGaugeFillColor(entity);
  return {
    data: {
      labels: ["Score", "Remaining"],
      datasets: [
        {
          data: [s, 100 - s],
          backgroundColor: [color, "#f3f4f6"],
          borderWidth: 0,
          borderRadius: s > 0 ? 10 : 0,
        },
      ],
    },
    score: s,
  };
}
