import fs from "fs";
import csv from "csv-parser";
import mysql from "mysql2";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from "dotenv";
dotenv.config();

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root",
  database: process.env.DB_NAME || "company_data",
  port: process.env.DB_PORT || 3306,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

db.connect((err) => {
  if (err) {
    console.error("Failed to connect to MySQL:", err);
    process.exit(1);
  }
  
  // Create score column if it doesn't exist to prevent crash in UpdateScore API
  db.query("ALTER TABLE entities_final_1 ADD COLUMN score FLOAT NULL", (err) => {
    if (err && err.code !== 'ER_DUP_FIELDNAME') {
      console.log("Note: Could not add score column (might already exist or other error):", err.message);
    } else {
      console.log("Ensured 'score' column exists.");
    }
    processCSV();
  });
});

function processCSV() {
  const filePath = path.resolve(__dirname, "../Dataset/Intermediate-Credit-Risk-UseCase-DataSet/credit_risk_dataset_50_entities.csv");
  
  if (!fs.existsSync(filePath)) {
     console.log("CSV not found at", filePath);
     process.exit(1);
  }

  const results = [];
  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", () => {
      let count = 0;
      let inserted = 0;
      
      if (results.length === 0) {
        console.log("No data found in CSV");
        process.exit(0);
      }

      results.forEach((row, i) => {
        const sql = `INSERT IGNORE INTO entities_final_1 
        (entity_id, entity_name, sector, country, ownership_type, revenue_usd_m, ebitda_margin_pct, total_assets_usd_m) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [
            row.entity_id, 
            row.entity_name, 
            row.sector, 
            row.country, 
            row.ownership_type,
            parseFloat(row.revenue_usd_m) || 0,
            parseFloat(row.ebitda_margin_pct) || 0,
            parseFloat(row.total_assets_usd_m) || 0
        ];
        
        db.query(sql, values, (err, res) => {
          count++;
          if (!err && res.affectedRows > 0) inserted++;
          
          if (count === results.length) {
             console.log(`Finished processing. Inserted ${inserted} new records out of ${results.length}.`);
             process.exit(0);
          }
        });
      });
    });
}
