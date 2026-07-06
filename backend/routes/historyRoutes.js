import { Router } from "express";
import pool from "../services/db.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

/**
 * @route   GET /api/history
 * @desc    Fetch current authenticated user's search history
 */
router.get("/api/history", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      "SELECT id, query, symbol, summary, created_at FROM search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [userId]
    );
    res.json({
      success: true,
      history: result.rows
    });
  } catch (error) {
    console.error("Error fetching search history:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * @route   DELETE /api/history/:id
 * @desc    Delete a specific history entry
 */
router.delete("/api/history/:id", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const historyId = req.params.id;

    const result = await pool.query(
      "DELETE FROM search_history WHERE id = $1 AND user_id = $2 RETURNING *",
      [historyId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "History entry not found." });
    }

    res.json({
      success: true,
      message: "History entry deleted successfully."
    });
  } catch (error) {
    console.error("Error deleting history entry:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * @route   DELETE /api/history
 * @desc    Clear all search history for current user
 */
router.delete("/api/history", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    await pool.query(
      "DELETE FROM search_history WHERE user_id = $1",
      [userId]
    );
    res.json({
      success: true,
      message: "Search history cleared successfully."
    });
  } catch (error) {
    console.error("Error clearing search history:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
