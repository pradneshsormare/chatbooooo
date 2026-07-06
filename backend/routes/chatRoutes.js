// chatRoutes.js — Routes for /api/chat

import { Router } from "express";
import { handleChat } from "../controllers/chatController.js";

const router = Router();

router.post("/api/chat", handleChat);

export default router;
