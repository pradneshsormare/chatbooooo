// marketRoutes.js — Routes for /api/candles

import { Router } from "express";
import { getCandles } from "../controllers/marketController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/api/candles", authenticate, getCandles);

export default router;
