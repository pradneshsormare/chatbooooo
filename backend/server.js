// server.js — Express application entry point
// All business logic lives in services/, controllers/, and routes/

import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// Route imports
import authRoutes from "./routes/authRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import marketRoutes from "./routes/marketRoutes.js";
import terminalRoutes from "./routes/terminalRoutes.js";
import historyRoutes from "./routes/historyRoutes.js";
import { initDatabase } from "./services/db.js";

const app = express();

// Initialize Database Connection
initDatabase();

// --- Middleware ---
app.use(express.json());

// Serve frontend static files from the frontend/ directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));

// --- Health check ---
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "Backend connected successfully"
  });
});

// --- Register routes ---
app.use(authRoutes);
app.use(chatRoutes);
app.use(marketRoutes);
app.use(terminalRoutes);
app.use(historyRoutes);


// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TradeBot server running at http://localhost:${PORT}`));
