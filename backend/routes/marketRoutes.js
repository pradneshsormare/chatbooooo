// marketRoutes.js — Routes for /api/candles

import { Router } from "express";
import { getCandles } from "../controllers/marketController.js";

const router = Router();

router.get("/api/candles", getCandles);

export default router;
