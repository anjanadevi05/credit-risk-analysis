/** Metrics keys that map to scalar columns on entities_final_1 (plus metrics_json). */
const METRIC_DB_COLUMNS = new Set([
  "revenue_usd_m",
  "ebitda_margin_pct",
  "ebit_margin_pct",
  "cash_usd_m",
  "total_assets_usd_m",
  "equity_usd_m",
  "net_debt_usd_m",
  "debt_to_equity",
  "interest_expense_usd_m",
  "interest_coverage",
  "operating_cf_usd_m",
  "capex_usd_m",
  "fcf_usd_m",
  "dscr",
  "current_ratio",
  "quick_ratio",
  "dso_days",
  "dpo_days",
  "dio_days",
  "revenue_cagr_3y_pct",
  "years_in_operation",
  "auditor_tier",
  "governance_score_0_100",
  "esg_controversies_3y",
  "country_risk_0_100",
  "industry_cyclicality",
  "fx_revenue_pct",
  "hedging_policy",
  "collateral_coverage_pct",
  "covenant_quality",
  "payment_incidents_12m",
  "legal_disputes_open",
  "sanctions_exposure",
  "financials_audited",
  "PD_1y_pct",
  "LGD_pct",
  "EAD_usd_m",
  "risk_bucket",
  "implied_rating",
]);

function sqlPartsForMetricsUpdate(metrics) {
  const setParts = ["metrics_json = ?"];
  const values = [JSON.stringify(metrics)];
  for (const [k, v] of Object.entries(metrics)) {
    if (!METRIC_DB_COLUMNS.has(k) || v === "" || v == null) continue;
    setParts.push(`${k} = ?`);
    values.push(v);
  }
  return { setParts, values };
}

/** Strip leading # so DB primary keys match CSV / Flask payloads. */
function normalizeEntityId(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  return s.startsWith("#") ? s.slice(1) : s;
}

/** Match legacy rows saved as #ENT or ENT. */
function entityIdVariants(raw) {
  const n = normalizeEntityId(raw);
  if (!n) return [];
  return [...new Set([n, `#${n}`])];
}

const AddEntities = (req, res) => {
  const db = req.db;

  const {
    entity_id,
    entity_name,
    sector,
    country,
    ownership_type
  } = req.body;

  const eid = normalizeEntityId(entity_id);
  if (!eid) {
    return res.status(400).json({ message: "entity_id required" });
  }

  const sql = `
    INSERT INTO entities_final_1  
    (entity_id, entity_name, sector, country, ownership_type)
    VALUES (?, ?, ?, ?, ?)
  `;

  const values = [
    eid,
    entity_name,
    sector,
    country,
    ownership_type
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Insert failed:", err);
      return res.status(500).json({ message: "Database insert error", error: err });
    }
    res.status(200).json({ message: "Record inserted successfully", insertedId: result.insertId });
  });
};

const GetEntities = (req, res) => {
  const db = req.db;

  const sql = `SELECT * FROM entities_final_1`;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Fetch failed:", err);
      return res.status(500).json({ message: "Database fetch error", error: err });
    }

    const data = (results || []).map((row) => {
      let metrics = {};
      let last_evaluation = null;
      try {
        if (row.metrics_json) metrics = JSON.parse(row.metrics_json);
      } catch {
        metrics = {};
      }
      try {
        if (row.evaluation_cache) last_evaluation = JSON.parse(row.evaluation_cache);
      } catch {
        last_evaluation = null;
      }
      const { metrics_json, evaluation_cache, ...rest } = row;
      return {
        ...rest,
        ...metrics,
        last_evaluation,
        entity_id: normalizeEntityId(rest.entity_id),
      };
    });

    return res.status(200).json({ data });
  });
};

const Update = (req, res) => {
  // Get the database connection from the request object
  const db = req.db; 
  const { entity_id, score } = req.body;

  // Validate request
  if (!entity_id || score === undefined) {
    return res.status(400).json({ error: "Missing entity_id or score" });
  }

  const ids = entityIdVariants(entity_id);
  const ph = ids.map(() => "?").join(",");
  const query = `UPDATE entities_final_1 SET score = ? WHERE entity_id IN (${ph})`;

  db.query(query, [score, ...ids], (err, result) => {
    if (err) {
      console.error("Error updating score:", err);
      return res.status(500).json({ error: "Database update failed" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Entity not found" });
    }

    // Return success response
    res.json({ success: true, entity_id: normalizeEntityId(entity_id), score });
  });
};

const UpdateEvaluation = (req, res) => {
  const db = req.db;
  const { entity_id, score, evaluation_cache } = req.body;

  if (!entity_id) {
    return res.status(400).json({ error: "Missing entity_id" });
  }

  const ids = entityIdVariants(entity_id);

  const cacheStr =
    evaluation_cache === undefined || evaluation_cache === null
      ? null
      : typeof evaluation_cache === "string"
        ? evaluation_cache
        : JSON.stringify(evaluation_cache);

  const updates = [];
  const values = [];

  if (score !== undefined && score !== null) {
    updates.push("score = ?");
    values.push(score);
  }
  if (cacheStr !== null) {
    updates.push("evaluation_cache = ?");
    values.push(cacheStr);
  }

  if (!updates.length) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const ph = ids.map(() => "?").join(",");
  values.push(...ids);
  const query = `UPDATE entities_final_1 SET ${updates.join(", ")} WHERE entity_id IN (${ph})`;

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Update evaluation cache failed:", err);
      return res.status(500).json({ error: "Database update failed", detail: err.message });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Entity not found" });
    }
    res.json({ success: true, entity_id: normalizeEntityId(entity_id) });
  });
};

const UpdateEntityMetrics = (req, res) => {
  const db = req.db;
  const { entity_id, metrics } = req.body;

  if (!entity_id || !metrics || typeof metrics !== "object") {
    return res.status(400).json({ error: "Missing entity_id or metrics object" });
  }

  const ids = entityIdVariants(entity_id);
  const { setParts, values } = sqlPartsForMetricsUpdate(metrics);
  const ph = ids.map(() => "?").join(",");
  const vals = [...values, ...ids];
  const sql = `UPDATE entities_final_1 SET ${setParts.join(", ")} WHERE entity_id IN (${ph})`;
  db.query(sql, vals, (err, result) => {
    if (err) {
      console.error("Metrics update failed:", err);
      return res.status(500).json({ error: "Database update failed", detail: err.message });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Entity not found" });
    }
    res.json({ success: true, entity_id: normalizeEntityId(entity_id) });
  });
};

const CORE_FIELDS = ["entity_id", "entity_name", "sector", "country", "ownership_type"];

const BulkAddEntities = (req, res) => {
  const db = req.db;
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "Provide JSON body { rows: [ {...}, ... ] }" });
  }

  /* Upsert identity so re-import runs metrics UPDATE (duplicate INSERT used to skip columns). */
  const insertSql = `
    INSERT INTO entities_final_1 (entity_id, entity_name, sector, country, ownership_type)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      entity_name = VALUES(entity_name),
      sector = VALUES(sector),
      country = VALUES(country),
      ownership_type = VALUES(ownership_type)
  `;

  let idx = 0;
  const errors = [];
  let imported = 0;

  const step = () => {
    if (idx >= rows.length) {
      return res.status(200).json({
        imported,
        failed: errors.length,
        errors,
        total: rows.length,
      });
    }

    const row = rows[idx];
    const rowNum = idx + 1;
    idx += 1;

    const entity_id =
      row.entity_id != null ? normalizeEntityId(String(row.entity_id).trim()) : "";
    const entity_name = row.entity_name != null ? String(row.entity_name).trim() : "";
    if (!entity_id || !entity_name) {
      errors.push({ row: rowNum, error: "entity_id and entity_name required" });
      return step();
    }

    const sector = row.sector != null ? String(row.sector) : "";
    const country = row.country != null ? String(row.country) : "";
    const ownership_type = row.ownership_type != null ? String(row.ownership_type) : "";

    const metrics = { ...row };
    CORE_FIELDS.forEach((k) => {
      delete metrics[k];
    });

    db.query(
      insertSql,
      [entity_id, entity_name, sector, country, ownership_type],
      (err) => {
        if (err) {
          errors.push({ row: rowNum, entity_id, error: err.message });
          return step();
        }

        const metricKeys = Object.keys(metrics).filter(
          (k) => metrics[k] !== "" && metrics[k] != null
        );
        if (metricKeys.length === 0) {
          imported += 1;
          return step();
        }

        const { setParts, values: setVals } = sqlPartsForMetricsUpdate(metrics);
        const idVars = entityIdVariants(entity_id);
        const ph = idVars.map(() => "?").join(",");
        const vals = [...setVals, ...idVars];

        db.query(
          `UPDATE entities_final_1 SET ${setParts.join(", ")} WHERE entity_id IN (${ph})`,
          vals,
          (mErr, mRes) => {
            if (mErr) {
              console.error(
                `[BulkImport] metrics UPDATE failed row ${rowNum} entity_id=${entity_id}:`,
                mErr.code,
                mErr.message
              );
              errors.push({ row: rowNum, entity_id, error: `metrics: ${mErr.message}` });
            } else if (!mRes || mRes.affectedRows === 0) {
              console.warn(
                `[BulkImport] metrics UPDATE matched 0 rows for entity_id=${entity_id} variants=${JSON.stringify(idVars)}`
              );
              errors.push({
                row: rowNum,
                entity_id,
                error: "metrics: no row matched (entity_id mismatch?)",
              });
            } else {
              imported += 1;
            }
            step();
          }
        );
      }
    );
  };

  step();
};

const DeleteEntity = (req, res) => {
  const db = req.db;
  const raw =
    req.query?.entity_id ?? req.params?.entity_id ?? req.body?.entity_id;
  if (!raw) {
    return res.status(400).json({ error: "Missing entity_id" });
  }
  const ids = entityIdVariants(raw);
  const sql = `DELETE FROM entities_final_1 WHERE entity_id IN (${ids.map(() => "?").join(",")})`;
  console.log("[DeleteEntity] request raw=", JSON.stringify(raw), "variants=", ids, "sql=", sql);
  db.query(sql, ids, (err, result) => {
    if (err) {
      console.error(
        "[DeleteEntity] MySQL error:",
        err.code,
        err.errno,
        err.sqlMessage || err.message
      );
      return res.status(500).json({
        error: "Database delete failed",
        detail: err.sqlMessage || err.message,
        code: err.code,
      });
    }
    const n = result?.affectedRows ?? 0;
    console.log("[DeleteEntity] affectedRows=", n, "variants=", ids);
    if (n === 0) {
      db.query(
        "SELECT entity_id FROM entities_final_1 WHERE entity_id LIKE ? LIMIT 5",
        [`%${String(raw).replace(/^#/, "")}%`],
        (probeErr, probeRows) => {
          if (!probeErr && probeRows?.length) {
            console.warn("[DeleteEntity] similar ids in DB:", probeRows.map((r) => r.entity_id));
          } else {
            console.warn("[DeleteEntity] no similar entity_id rows for probe like %", raw);
          }
        }
      );
      return res.status(404).json({
        error: "Entity not found",
        detail: `No row for entity_id IN (${ids.join(", ")})`,
        tried: ids,
      });
    }
    res.json({ success: true, entity_id: normalizeEntityId(raw) });
  });
};

export { AddEntities, GetEntities, Update, UpdateEvaluation, UpdateEntityMetrics, BulkAddEntities, DeleteEntity };
