import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
} from "chart.js";
import "./FrontPage.css";
import { buildEvaluatePayload, sameEntityId } from "../utils/evaluatePayload.js";
import {
  getDisplayRiskScore,
  buildGaugeData,
  entityGaugeFillColor,
} from "../utils/riskDisplay.js";
import { formatFactorLabel } from "../utils/factorLabel.js";
import { apiErrorMessage } from "../utils/apiErrorMessage.js";

const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const LLM_URL = import.meta.env.VITE_LLM_URL || "http://127.0.0.1:5000";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement
);

function computeFilteredEntities(entities, searchTerm, filterType) {
  let filtered = entities;
  const q = (searchTerm || "").trim().toLowerCase();
  if (q) {
    if (filterType === "score") {
      filtered = filtered.filter((item) => {
        const score = getDisplayRiskScore(item) ?? (Number(item.score) || 0);
        if (q === "low") return score <= 20;
        if (q === "medium") return score > 20 && score <= 30;
        if (q === "high") return score > 30;
        return String(score).includes(q);
      });
    } else if (filterType) {
      const field =
        filterType === "name" || filterType === "entity_name"
          ? "entity_name"
          : filterType;
      filtered = filtered.filter((item) => {
        const raw = item[field];
        if (raw === undefined || raw === null) return false;
        return String(raw).toLowerCase().includes(q);
      });
    } else {
      filtered = filtered.filter((item) => {
        const hay = [
          item.entity_id,
          item.entity_name,
          item.sector,
          item.country,
          item.ownership_type,
        ]
          .filter((x) => x !== undefined && x !== null && x !== "")
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
  }
  return filtered;
}

const FrontPage = () => {
  const navigate = useNavigate();
  const [entities, setEntities] = useState([]);
  const [filteredEntities, setFilteredEntities] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(6);
  const [loading, setLoading] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [isAddEntityOpen, setIsAddEntityOpen] = useState(false);
  const [newEntity, setNewEntity] = useState({
    entity_id: "",
    entity_name: "",
    sector: "",
    country: "",
    ownership_type: ""
  });
  const [isAdding, setIsAdding] = useState(false);
  const metricsFileRef = useRef(null);
  const bulkEntitiesFileRef = useRef(null);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [addEntityMode, setAddEntityMode] = useState("manual");
  const [evaluateError, setEvaluateError] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    evaluated: 0,
    averageScore: 0,
  });

  useEffect(() => {
    fetchEntities();
  }, []);

  useEffect(() => {
    const filtered = computeFilteredEntities(entities, searchTerm, filterType);
    setFilteredEntities(filtered);
    setCurrentPage((p) => {
      const tp = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
      return Math.min(Math.max(1, p), tp);
    });
    calculateStats();
  }, [searchTerm, filterType, entities]);

  const calculateStats = () => {
    const total = entities.length;
    const evaluated = entities.filter(
      (e) =>
        (e.score !== undefined && e.score !== null && e.score !== "") ||
        (e.factors && e.factors.length) ||
        e.last_evaluation?.factors?.length
    ).length;
    
    const scores = entities
      .map((e) => getDisplayRiskScore(e) ?? (Number(e.score) || 0))
      .filter((s) => s > 0);
      
    const averageScore =
      scores.length > 0
        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
        : 0;

    setStats({ total, evaluated, averageScore });
  };

  const fetchEntities = async () => {
    try {
      const response = await axios.get(`${API_URL}/GetAll`);
      const rows = (response.data.data || []).map((row) => {
        const le = row.last_evaluation;
        if (!le?.factors) return row;
        return {
          ...row,
          factors: row.factors ?? le.factors,
          summary: row.summary ?? le.summary,
          final_evaluation: row.final_evaluation ?? le.final_evaluation,
          advanced_details: row.advanced_details ?? le.advanced_details,
        };
      });
      rows.sort((a, b) =>
        String(a.entity_id ?? "").localeCompare(String(b.entity_id ?? ""), undefined, {
          numeric: true,
        })
      );
      setEntities(rows);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  const convertToScore = (value) => {
    if (typeof value === "number") return value;
    switch (value?.toLowerCase()) {
      case "low":
        return 30;
      case "medium":
        return 60;
      case "high":
        return 90;
      default:
        return 0;
    }
  };

  /** Factor bar color: Low = lower credit risk (green), High = higher credit risk (red). */
  const getFactorSeverityColor = (evaluation) => {
    switch (evaluation?.toLowerCase()) {
      case "low":
        return "#10b981";
      case "medium":
        return "#f59e0b";
      case "high":
        return "#ef4444";
      default:
        return "#9ca3af";
    }
  };

  /** Handles quoted fields and commas inside quotes (dataset-style CSV). */
  const parseCsvLine = (line) => {
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQ = false;
          }
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQ = true;
      } else if (c === ",") {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim());
    return cells.map((s) => s.replace(/^"(.*)"$/, "$1"));
  };

  const parseMetricsCsv = (text) => {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      if (cells.length < headers.length) continue;
      const obj = {};
      headers.forEach((h, j) => {
        const raw = cells[j];
        if (raw === "" || raw === undefined) return;
        if (h === "entity_id") {
          obj[h] = String(raw).trim().replace(/^#/, "");
          return;
        }
        const n = Number(raw);
        obj[h] = Number.isFinite(n) ? n : raw;
      });
      rows.push(obj);
    }
    return rows;
  };

  const gauge = selectedEntity ? buildGaugeData(selectedEntity) : null;

  const getFactorChartData = (factor) => {
    return {
      labels: [
        factor.evaluation?.charAt(0)?.toUpperCase() +
          factor.evaluation?.slice(1) || "N/A",
      ],
      datasets: [
        {
          label: formatFactorLabel(factor.factor),
          data: [convertToScore(factor.evaluation)],
          backgroundColor: [getFactorSeverityColor(factor.evaluation)],
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    };
  };

  const handleFilter = () => {
    const filtered = computeFilteredEntities(entities, searchTerm, filterType);
    setFilteredEntities(filtered);
    setCurrentPage(1);
  };

  const indexOfLast = currentPage * itemsPerPage;
  const indexOfFirst = indexOfLast - itemsPerPage;
  const currentEntities = filteredEntities.slice(indexOfFirst, indexOfLast);
  const totalPages = Math.ceil(filteredEntities.length / itemsPerPage);
  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  const persistEvaluation = async (evaluatedData, finalScore) => {
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
      console.error("Failed to persist evaluation:", dbError);
    }
  };

  const handleEvaluate = async (entity) => {
    setSelectedEntity(entity);
    setIsModalOpen(true);
    setLoading(true);
    setEvaluateError(null);

    try {
      const response = await axios.post(
        LLM_URL,
        buildEvaluatePayload(entity),
        { timeout: 600000 }
      );
      const data = response.data;
      if (!data?.factors?.length) {
        setEvaluateError(
          "No factors returned — is the rules CSV loaded on the LLM server? Check the LLM terminal."
        );
        setLoading(false);
        return;
      }
      const evaluatedData = { ...entity, ...data };

      const finalScore = getDisplayRiskScore(evaluatedData);

      if (finalScore !== undefined && finalScore !== null) {
        try {
          await axios.put(`${API_URL}/UpdateScore`, {
            entity_id: entity.entity_id,
            score: finalScore,
          });
        } catch (dbError) {
          console.error(
            `Failed to update score in DB for entity ${entity.entity_id}:`,
            dbError
          );
        }
      }

      await persistEvaluation(evaluatedData, finalScore);

      const merged = {
        ...evaluatedData,
        last_evaluation: {
          factors: evaluatedData.factors,
          summary: evaluatedData.summary,
          memorandum_summary: evaluatedData.memorandum_summary,
          final_evaluation: evaluatedData.final_evaluation,
          advanced_details: evaluatedData.advanced_details,
          final_confidence: evaluatedData.final_confidence,
          rag: evaluatedData.rag,
        },
      };

      setSelectedEntity(merged);
      setEntities((prev) =>
        prev.map((e) => (sameEntityId(e.entity_id, entity.entity_id) ? merged : e))
      );
    } catch (error) {
      console.error("Error calling LLM backend:", error);
      const msg =
        error.response?.data?.error ||
        error.response?.data?.message ||
        error.message ||
        "Request failed";
      setEvaluateError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleViewResults = (entity) => {
    if (!entity?.last_evaluation?.factors) return;
    setEvaluateError(null);
    const merged = {
      ...entity,
      ...entity.last_evaluation,
    };
    setSelectedEntity(merged);
    setIsModalOpen(true);
    setLoading(false);
  };

  const handleEvaluateAll = async () => {
    setLoadingAll(true);
    try {
      const results = [];
      // Process each entity sequentially to prevent crashing the local Ollama GPU
      for (const entity of entities) {
        try {
          const res = await axios.post(
            LLM_URL,
            buildEvaluatePayload(entity),
            { timeout: 600000 }
          );
          const evaluatedEntity = { ...entity, ...res.data };
          results.push(evaluatedEntity);

          const score = getDisplayRiskScore(evaluatedEntity);
          if (score !== undefined && score !== null) {
            await axios.put(`${API_URL}/UpdateScore`, {
              entity_id: evaluatedEntity.entity_id,
              score: score,
            });
          }
          await persistEvaluation(evaluatedEntity, score);

          const merged = {
            ...evaluatedEntity,
            last_evaluation: {
              factors: evaluatedEntity.factors,
              summary: evaluatedEntity.summary,
              memorandum_summary: evaluatedEntity.memorandum_summary,
              final_evaluation: evaluatedEntity.final_evaluation,
              advanced_details: evaluatedEntity.advanced_details,
              final_confidence: evaluatedEntity.final_confidence,
              rag: evaluatedEntity.rag,
            },
          };

          setEntities((prev) =>
            prev.map((e) =>
              sameEntityId(e.entity_id, merged.entity_id) ? merged : e
            )
          );
          setFilteredEntities((prev) =>
            prev.map((e) =>
              sameEntityId(e.entity_id, merged.entity_id) ? merged : e
            )
          );
        } catch (err) {
          console.error(`Error evaluating ${entity.entity_id}:`, err);
        }
      }
    } catch (error) {
      console.error("Error evaluating all entities:", error);
    } finally {
      setLoadingAll(false);
    }
  };

  const handleBulkCsvImport = async () => {
    const file = bulkEntitiesFileRef.current?.files?.[0];
    if (!file) {
      alert("Choose a CSV file with the same columns as the dataset (entity_id, entity_name, sector, …).");
      return;
    }
    setIsBulkImporting(true);
    try {
      const text = await file.text();
      const rows = parseMetricsCsv(text).map((r) => ({
        ...r,
        entity_id:
          r.entity_id != null
            ? String(r.entity_id).trim().replace(/^#/, "")
            : r.entity_id,
      }));
      if (!rows.length) {
        alert("No data rows found (need header + at least one row).");
        return;
      }
      const missing = rows.find((r) => !r.entity_id || !r.entity_name);
      if (missing) {
        alert(
          "Bulk import skipped: every row must include entity_id and entity_name. " +
            "Use the full template: entity_id, entity_name, sector, country, ownership_type, then revenue_usd_m, ebitda_margin_pct, … " +
            "(A file with only metric columns and no entity_id will not insert anything.)"
        );
        return;
      }
      const res = await axios.post(`${API_URL}/bulkImport`, { rows });
      const { imported, failed, total, errors } = res.data;
      const msg = `Imported ${imported} of ${total}. Failed: ${failed}.`;
      if (errors?.length) console.warn(errors);
      alert(msg);
      await fetchEntities();
      setCurrentPage(1);
      if (bulkEntitiesFileRef.current) bulkEntitiesFileRef.current.value = "";
    } catch (err) {
      console.error(err);
      alert(`Bulk import failed: ${apiErrorMessage(err)}`);
    } finally {
      setIsBulkImporting(false);
    }
  };

  const handleAddEntity = async (e) => {
    e.preventDefault();
    if (!newEntity.entity_id || !newEntity.entity_name) return;
    const canonicalId = String(newEntity.entity_id).trim().replace(/^#/, "");
    const payload = { ...newEntity, entity_id: canonicalId };
    setIsAdding(true);
    try {
      await axios.post(`${API_URL}/add`, payload);

      const file = metricsFileRef.current?.files?.[0];
      if (file) {
        try {
          const text = await file.text();
          const rows = parseMetricsCsv(text);
          const row =
            rows.find((r) => String(r.entity_id) === canonicalId) || rows[0];
          if (row && Object.keys(row).length) {
            await axios.put(`${API_URL}/entityMetrics`, {
              entity_id: canonicalId,
              metrics: row,
            });
          }
        } catch (metricsErr) {
          console.error("Metrics upload failed after add:", metricsErr);
          alert(
            "Entity was saved, but metrics CSV upload failed. Refresh the list and re-upload metrics if needed."
          );
        }
      }

      await fetchEntities();
      setIsAddEntityOpen(false);
      setAddEntityMode("manual");
      setNewEntity({
        entity_id: "",
        entity_name: "",
        sector: "",
        country: "",
        ownership_type: "",
      });
      if (metricsFileRef.current) metricsFileRef.current.value = "";
    } catch (error) {
      console.error("Error adding entity:", error);
      alert(
        error.response?.data?.message ||
          error.response?.data?.error ||
          "Failed to add entity. Check the console and IMPLEMENTATION.md (DB / duplicate entity_id)."
      );
      await fetchEntities();
    } finally {
      setIsAdding(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedEntity(null);
    setEvaluateError(null);
  };

  const closeAddEntityModal = () => {
    setIsAddEntityOpen(false);
    setAddEntityMode("manual");
  };

  const handleDeleteEntity = async (item) => {
    if (
      !window.confirm(
        `Permanently delete "${item.entity_name}" (${item.entity_id})? This removes the entity from the database.`
      )
    ) {
      return;
    }
    try {
      await axios.delete(`${API_URL}/entity`, {
        params: { entity_id: String(item.entity_id) },
      });
      await fetchEntities();
      if (sameEntityId(selectedEntity?.entity_id, item.entity_id)) {
        closeModal();
      }
    } catch (err) {
      const status = err.response?.status;
      const short = apiErrorMessage(err);
      console.error("[DeleteEntity]", { status, entity_id: item.entity_id, short });
      if (status === 404) {
        await fetchEntities();
        if (sameEntityId(selectedEntity?.entity_id, item.entity_id)) {
          closeModal();
        }
        alert(`Delete: no row matched for "${item.entity_id}". ${short}`);
        return;
      }
      alert(`Delete failed: ${short}`);
    }
  };

  return (
    <div className="page-container">
      {/* Header Section */}
      <header className="dashboard-header">
        <div className="header-content">
          <div className="title-section">
            <h1 className="title">Entity Risk Dashboard</h1>
            <p className="subtitle">
              Monitor and evaluate entity risk profiles
            </p>
          </div>
          <div className="stats-container">
            <div className="stat-card">
              <div className="stat-icon">🏢</div>
              <div className="stat-info">
                <span className="stat-value">{stats.total}</span>
                <span className="stat-label">Total Entities</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">📊</div>
              <div className="stat-info">
                <span className="stat-value">{stats.evaluated}</span>
                <span className="stat-label">Evaluated</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">⭐</div>
              <div className="stat-info">
                <span className="stat-value">{stats.averageScore}</span>
                <span className="stat-label">Avg Score</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Controls Section */}
      <section className="controls-section">
        <div className="controls-container">
          <div className="search-filter-group">
            <div className="search-wrapper">
              <button
                type="button"
                className="search-submit-btn"
                onClick={() => handleFilter()}
                title="Apply search"
                aria-label="Search"
              >
                🔍
              </button>
              <input
                type="text"
                placeholder={
                  filterType === "score"
                    ? "Score: number or low / medium / high"
                    : filterType
                      ? `Search by ${filterType.replace("_", " ")}`
                      : "Search id, name, sector, country…"
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleFilter();
                  }
                }}
                className="search-input"
              />
            </div>
            <select
              className="filter-select"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">All Filters</option>
              <option value="sector">Sector</option>
              <option value="country">Country</option>
              <option value="ownership_type">Ownership</option>
              <option value="entity_name">Entity Name</option>
              <option value="name">Name</option>
              <option value="score">Score</option>
            </select>
          </div>

          <button
            className="eval-all-button add-entity-btn"
            onClick={() => setIsAddEntityOpen(true)}
          >
            <span className="button-icon">➕</span>
            Add New Entity
          </button>
          <button
            className="eval-all-button"
            onClick={handleEvaluateAll}
            disabled={loadingAll}
          >
            <span className="button-icon">⚡</span>
            {loadingAll ? "Evaluating All..." : "Evaluate All Entities"}
          </button>
          <button className="eval-all-button" onClick={() => navigate("/advanced")}>
            <span className="button-icon">📘</span>
            Advanced Dashboard
          </button>
        </div>
      </section>

      {/* Table Section */}
      <section className="table-section">
        <div className="table-container">
          <div className="table-header-section">
            <h3 className="table-title">Entity List</h3>
            <span className="table-count">
              {filteredEntities.length} entities found
            </span>
          </div>

          <div className="table-wrapper">
            <table className="table">
              <thead className="table-header">
                <tr>
                  <th>Entity ID</th>
                  <th>Name</th>
                  <th>Sector</th>
                  <th>Country</th>
                  <th>Ownership</th>
                  <th>Score</th>
                  <th>View</th>
                  <th>Evaluate</th>
                  <th className="col-actions" aria-label="Remove entity" />
                </tr>
              </thead>
              {/* 3. MODIFIED TABLE BODY */}
              <tbody>
                {currentEntities.map((item, index) => {
                  // Calculate the score to be used for this row
                  const displayScore = getDisplayRiskScore(item) ?? item.score;
                  
                  return (
                    <tr
                      key={String(item.entity_id)}
                      className="table-row"
                      style={{ animationDelay: `${index * 0.1}s` }}
                    >
                      <td>
                        <span className="entity-id">
                          {String(item.entity_id ?? "").replace(/^#/, "")}
                        </span>
                      </td>
                      <td>
                        <div className="entity-name">
                          <span className="name-text">{item.entity_name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="sector-tag">{item.sector}</span>
                      </td>
                      <td>
                        <span className="country-flag">🌍</span>
                        {item.country}
                      </td>
                      <td>
                        <span
                          className={`ownership-badge ${item.ownership_type?.toLowerCase()}`}
                        >
                          {item.ownership_type}
                        </span>
                      </td>
                      <td>
                        <div className="score-display">
                          <div className="score-bar">
                            <div
                              className="score-fill"
                              style={{
                                // Use the calculated displayScore for the width
                                width: `${displayScore ?? 0}%`,
                                // Use the new helper function for the color
                                backgroundColor: entityGaugeFillColor(item),
                              }}
                            ></div>
                          </div>
                          <span className="score-value">
                            {/* Use the calculated displayScore for the text */}
                            {displayScore !== undefined && displayScore !== null
                              ? displayScore
                              : "-"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleViewResults(item)}
                          className="view-button"
                          disabled={!item.last_evaluation?.factors}
                          title={
                            item.last_evaluation?.factors
                              ? "Open last evaluation"
                              : "Evaluate first to cache results"
                          }
                        >
                          View
                        </button>
                      </td>
                      <td>
                        <button
                          onClick={() => handleEvaluate(item)}
                          className="eval-button"
                          disabled={
                            loading &&
                            sameEntityId(selectedEntity?.entity_id, item.entity_id)
                          }
                        >
                          {loading &&
                          sameEntityId(selectedEntity?.entity_id, item.entity_id) ? (
                            <div className="button-spinner"></div>
                          ) : (
                            <span>Evaluate</span>
                          )}
                        </button>
                      </td>
                      <td className="col-actions">
                        <button
                          type="button"
                          className="delete-entity-btn"
                          onClick={() => handleDeleteEntity(item)}
                          title="Delete entity from database"
                          aria-label={`Delete ${item.entity_name}`}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination-section">
              <div className="pagination-info">
                Showing {indexOfFirst + 1}-
                {Math.min(indexOfLast, filteredEntities.length)} of{" "}
                {filteredEntities.length}
              </div>
              <div className="pagination">
                <button
                  onClick={() => paginate(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="pagination-arrow"
                >
                  ←
                </button>
                {[...Array(Math.min(5, totalPages))].map((_, index) => {
                  const pageNum =
                    currentPage <= 3
                      ? index + 1
                      : Math.max(1, currentPage - 2) + index;
                  if (pageNum > totalPages) return null;

                  return (
                    <button
                      key={pageNum}
                      className={currentPage === pageNum ? "active-page" : ""}
                      onClick={() => paginate(pageNum)}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() =>
                    paginate(Math.min(totalPages, currentPage + 1))
                  }
                  disabled={currentPage === totalPages}
                  className="pagination-arrow"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Modal */}
      {isModalOpen && selectedEntity && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeModal} className="close-button">
              ✕
            </button>

            <div className="modal-header">
              <h2 className="modal-title">{selectedEntity.entity_name}</h2>
              <p className="modal-subtitle">Risk Evaluation Results</p>
            </div>

            {loading ? (
              <div className="loading-state">
                <div className="loading-spinner"></div>
                <p>Analyzing entity risk profile...</p>
              </div>
            ) : (
              <>
                {evaluateError && (
                  <div className="eval-error-banner" role="alert">
                    {evaluateError}
                  </div>
                )}
                {!gauge && (
                  <p className="modal-eval-hint">
                    Run <strong>Evaluate</strong> to load the gauge, factors, and narrative. Ensure the
                    Python API is running on port 5000.
                  </p>
                )}
                {/* Score Gauge */}
                {gauge && (
                  <div className="score-section">
                    <div className="gauge-container">
                      <div className="gauge-wrapper">
                        <Doughnut
                          data={gauge.data}
                          options={{
                            rotation: -90,
                            circumference: 180,
                            cutout: "75%",
                            plugins: {
                              legend: { display: false },
                              tooltip: { enabled: false },
                            },
                            maintainAspectRatio: false,
                          }}
                        />
                        <div className="gauge-center">
                          <span className="gauge-score">{gauge.score}</span>
                          <span className="gauge-label">/100</span>
                        </div>
                      </div>
                    </div>
                    <div className="score-indicators">
                      <div className="score-indicator low">
                        <span>Low Risk</span>
                        <div className="indicator-bar"></div>
                      </div>
                      <div className="score-indicator medium">
                        <span>Medium Risk</span>
                        <div className="indicator-bar"></div>
                      </div>
                      <div className="score-indicator high">
                        <span>High Risk</span>
                        <div className="indicator-bar"></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Factors Grid */}
                <div className="factors-section">
                  <h3 className="factors-title">Risk Factors</h3>
                  <div className="factors-grid">
                    {selectedEntity.factors &&
                      selectedEntity.factors.map((factor, index) => (
                        <div key={index} className="factor-card">
                          <div className="factor-header">
                            <h4 className="factor-name">
                              {formatFactorLabel(factor.factor)}
                            </h4>
                            <span
                              className={`factor-badge sev-${factor.evaluation?.toLowerCase() || "unknown"}`}
                            >
                              {factor.evaluation}
                            </span>
                          </div>
                          <div className="factor-chart">
                            <Bar
                              data={getFactorChartData(factor)}
                              options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                  legend: { display: false },
                                  tooltip: { enabled: true },
                                },
                                scales: {
                                  x: {
                                    display: false,
                                    title: { display: false },
                                  },
                                  y: {
                                    min: 0,
                                    max: 100,
                                    ticks: { display: false },
                                    grid: { display: false },
                                  },
                                },
                                indexAxis: "y",
                              }}
                              height={60}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Summary + RAG Evidence */}
                <div className="summary-section">
                  <div className="summary-header-row">
                    <h3 className="factors-title">Risk Assessment Summary</h3>
                  </div>
                  <div className="summary-card risk-narrative-body">
                    <p>
                      {selectedEntity.summary ||
                        selectedEntity.last_evaluation?.summary ||
                        "No summary available."}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Entity Modal */}
      {isAddEntityOpen && (
        <div className="modal-overlay" onClick={closeAddEntityModal}>
          <div className="modal-box add-entity-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={closeAddEntityModal} className="close-button">✕</button>
            <div className="modal-header">
              <h2 className="modal-title">Add New Entity</h2>
              <p className="modal-subtitle">Choose manual entry or bulk CSV import</p>
            </div>
            <div className="add-entity-mode-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                className={`mode-tab ${addEntityMode === "manual" ? "active" : ""}`}
                onClick={() => setAddEntityMode("manual")}
              >
                Manual entry
              </button>
              <button
                type="button"
                role="tab"
                className={`mode-tab ${addEntityMode === "csv" ? "active" : ""}`}
                onClick={() => setAddEntityMode("csv")}
              >
                Import CSV
              </button>
            </div>
            {addEntityMode === "manual" ? (
              <form onSubmit={handleAddEntity} className="add-entity-form">
                <div className="form-group">
                  <label>Entity ID *</label>
                  <input required type="text" value={newEntity.entity_id} onChange={e => setNewEntity({...newEntity, entity_id: e.target.value})} placeholder="e.g. ENT051" />
                </div>
                <div className="form-group">
                  <label>Entity Name *</label>
                  <input required type="text" value={newEntity.entity_name} onChange={e => setNewEntity({...newEntity, entity_name: e.target.value})} placeholder="e.g. Acme Corp" />
                </div>
                <div className="form-group">
                  <label>Sector</label>
                  <input type="text" value={newEntity.sector} onChange={e => setNewEntity({...newEntity, sector: e.target.value})} placeholder="e.g. Technology" />
                </div>
                <div className="form-group">
                  <label>Country</label>
                  <input type="text" value={newEntity.country} onChange={e => setNewEntity({...newEntity, country: e.target.value})} placeholder="e.g. United States" />
                </div>
                <div className="form-group">
                  <label>Ownership Type</label>
                  <select value={newEntity.ownership_type} onChange={e => setNewEntity({...newEntity, ownership_type: e.target.value})}>
                    <option value="">Select...</option>
                    <option value="Public">Public</option>
                    <option value="Private">Private</option>
                    <option value="State-Owned">State-Owned</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>
                    Optional: financial metrics (CSV, one row — same columns as{" "}
                    <a href="/entity_metrics_template.csv" download>template</a>)
                  </label>
                  <input
                    ref={metricsFileRef}
                    type="file"
                    accept=".csv"
                    className="file-input-outline"
                  />
                  <p className="form-hint">
                    Add EAD_usd_m, PD_1y_pct, LGD_pct, etc. for portfolio-style sections in the advanced report.
                  </p>
                </div>
                <button type="submit" className="eval-all-button primary-submit" disabled={isAdding}>
                  {isAdding ? "Adding..." : "Save Entity"}
                </button>
              </form>
            ) : (
              <div className="add-entity-form csv-import-panel">
                <p className="form-hint">
                  Use the same header as <code>credit_risk_dataset_50_entities.csv</code>. Each row creates
                  one entity; columns beyond the core five are stored as metrics.
                </p>
                <div className="form-group">
                  <label>Entity spreadsheet (CSV)</label>
                  <input
                    ref={bulkEntitiesFileRef}
                    type="file"
                    accept=".csv"
                    className="file-input-outline"
                  />
                </div>
                <button
                  type="button"
                  className="eval-all-button secondary-outline-btn"
                  disabled={isBulkImporting}
                  onClick={handleBulkCsvImport}
                >
                  {isBulkImporting ? "Importing…" : "Import CSV rows"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export { FrontPage };