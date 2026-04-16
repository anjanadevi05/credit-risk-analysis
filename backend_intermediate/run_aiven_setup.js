import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import mysql from "mysql2";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root",
  database: process.env.DB_NAME || "company_data",
  port: process.env.DB_PORT || 3306,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  multipleStatements: true
});

db.connect((err) => {
  if (err) {
    console.error("Connection Failed:", err);
    process.exit(1);
  }

  console.log("Connected to Cloud Database! Setting up Schema...");

  // Load the schema but remove the "USE company_data;" and "CREATE DATABASE" parts 
  // since Aiven provides "defaultdb" out of the box and we are already connected to it.
  const schemaPath = path.resolve(__dirname, "../company_data_schema.sql");
  let schemaSql = fs.readFileSync(schemaPath, "utf8");
  schemaSql = schemaSql.replace(/CREATE DATABASE IF NOT EXISTS company_data;/gi, "");
  schemaSql = schemaSql.replace(/USE company_data;/gi, "");

  db.query(schemaSql, (err) => {
    if (err) {
      console.error("Schema creation failed (might already exist):", err.message);
    } else {
      console.log("Schema applied successfully.");
    }

    console.log("Now launching the CSV data importer...");
    import("./import_csv_to_db.js")
      .then(() => {
        console.log("Import script triggered.");
        // The import script has its own db connection and will exit the process when done.
      })
      .catch((e) => console.error("Error running import script:", e));
  });
});
