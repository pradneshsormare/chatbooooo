// chatRoutes.js — Routes for /api/chat

import { Router } from "express";
import { handleChat } from "../controllers/chatController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/api/chat", authenticate, handleChat);

export default router;
