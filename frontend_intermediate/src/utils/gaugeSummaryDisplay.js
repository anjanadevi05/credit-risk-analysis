/** Remove the final "Recommended action:" block from the short gauge narrative (Advanced dashboard). */
export function stripGaugeRecommendedAction(text) {
  if (!text) return "";
  const t = String(text).trim();
  const idx = t.search(/\n\s*Recommended action:/i);
  if (idx >= 0) return t.slice(0, idx).trim();
  return t;
}
