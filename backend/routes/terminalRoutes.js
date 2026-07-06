// terminalRoutes.js — Routes for /api/terminal-analyze

import { Router } from "express";
import { analyzeTerminal } from "../controllers/terminalController.js";

const router = Router();

router.post("/api/terminal-analyze", analyzeTerminal);

export default router;
