// terminalRoutes.js — Routes for /api/terminal-analyze

import { Router } from "express";
import { analyzeTerminal } from "../controllers/terminalController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/api/terminal-analyze", authenticate, analyzeTerminal);

export default router;
