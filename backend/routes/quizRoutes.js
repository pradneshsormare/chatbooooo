// quizRoutes.js — Routes for /api/quiz

import { Router } from "express";
import { generateQuiz } from "../controllers/quizController.js";

const router = Router();

router.post("/api/quiz", generateQuiz);

export default router;
