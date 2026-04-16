/** Strip cached / UI-only fields so POST /evaluate matches a clean entity + metrics payload. */
const OMIT_FROM_EVALUATE = new Set([
  "last_evaluation",
  "factors",
  "summary",
  "advanced_details",
  "final_evaluation",
  "final_confidence",
  "rag",
  "final_eval_expected",
  "final_eval_accuracy_%",
  "composite_score",
]);

/** DB-only columns — must not be sent to JSON APIs (MySQL bigint `id` breaks JSON.stringify → "Network Error"). */
const OMIT_DB_META = new Set(["id", "insertId"]);

const MAX_DEPTH = 14;

/**
 * Recursively make values JSON-serializable (BigInt, NaN, nested objects from DB).
 * Prevents axios from throwing before the request is sent.
 */
function deepJsonSafe(value, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((x) => deepJsonSafe(x, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepJsonSafe(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function stripLeadingHashEntityId(id) {
  if (id == null || id === "") return id;
  const s = typeof id === "bigint" ? String(Number(id)) : String(id).trim();
  return s.startsWith("#") ? s.slice(1) : s;
}

export function sanitizeEntityForEvaluate(entity) {
  const out = {};
  for (const [k, v] of Object.entries(entity || {})) {
    if (OMIT_FROM_EVALUATE.has(k) || OMIT_DB_META.has(k)) continue;
    out[k] = deepJsonSafe(v);
  }
  if (entity?.entity_id != null && entity.entity_id !== "") {
    out.entity_id = stripLeadingHashEntityId(entity.entity_id);
  }
  return out;
}

/** Default evaluate POST: clean entity + RAG + LLM enabled (backend also defaults use_rag true). */
export function buildEvaluatePayload(entity) {
  return { ...sanitizeEntityForEvaluate(entity), use_rag: true };
}

export function sameEntityId(a, b) {
  const na = String(a ?? "")
    .trim()
    .replace(/^#/, "");
  const nb = String(b ?? "")
    .trim()
    .replace(/^#/, "");
  return na === nb;
}
