import express from "express";
import mysql from "mysql";
import bodyparser from "body-parser";
import cors from "cors";
import route from "./routes/routes.js";
import { DeleteEntity } from "./controller/controller.js";

import dotenv from "dotenv";
dotenv.config();

const app = express();

const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root",
  database: process.env.DB_NAME || "company_data",
  port: process.env.DB_PORT || 3306,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

db.getConnection((err, connection) => {
  if (err) {
    console.error("MySQL pool connection failed:", err);
  } else {
    console.log("MySQL pool connected successfully");
    connection.release();
  }
});

app.use((req, res, next) => {
  req.db = db;
  next();
});

app.use(bodyparser.json());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Hello world ");
});

/* Express 5: register DELETE on app so it always matches (avoids 404 HTML "Cannot DELETE /entity"). */
app.delete("/entity", DeleteEntity);
app.delete("/entity/:entity_id", DeleteEntity);

app.use("/", route);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The application is running on port ${PORT}`);
});

export default db;