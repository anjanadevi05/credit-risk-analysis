-- Run once against database `company_data` (adjust if your DB name differs).
-- Stores last evaluation JSON and optional financial metrics JSON for entities not in the static CSV.

ALTER TABLE entities_final_1
  ADD COLUMN evaluation_cache LONGTEXT NULL COMMENT 'JSON: last evaluate response snapshot';

ALTER TABLE entities_final_1
  ADD COLUMN metrics_json LONGTEXT NULL COMMENT 'JSON: financial CSV fields merged for evaluation';
