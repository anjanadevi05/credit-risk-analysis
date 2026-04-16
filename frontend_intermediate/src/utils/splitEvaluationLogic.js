/** Break long evaluation_logic into readable blocks for the Advanced report. */
export function splitEvaluationLogic(text) {
  if (!text || typeof text !== "string") return [];
  const t = text.trim();
  if (!t) return [];
  const withBreaks = t
    .replace(/\.\s+(?=Interpretation:)/gi, ".\n\n")
    .replace(/\.\s+(?=Final bucket)/gi, ".\n\n")
    .replace(/\.\s+(?=Unique watch items:)/gi, ".\n\n");
  return withBreaks
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
