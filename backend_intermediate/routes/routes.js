import express from "express";
import {
  AddEntities,
  GetEntities,
  Update,
  UpdateEvaluation,
  UpdateEntityMetrics,
  BulkAddEntities,
} from "../controller/controller.js";

const router = express.Router();

router.post("/add", AddEntities);
router.post("/bulkImport", BulkAddEntities);
router.get("/GetAll", GetEntities);
router.put("/UpdateScore", Update);
router.put("/UpdateEvaluation", UpdateEvaluation);
router.put("/entityMetrics", UpdateEntityMetrics);

export default router;
