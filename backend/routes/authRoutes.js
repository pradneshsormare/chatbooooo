import { Router } from "express";
import { findUserByUsername, addUser } from "../services/userService.js";
import { hashPassword, verifyPassword, generateToken } from "../utils/auth.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 */
router.post("/api/auth/register", (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters long." });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const existingUser = findUserByUsername(trimmedUsername);
    if (existingUser) {
      return res.status(409).json({ error: "Username is already taken." });
    }

    const newUser = {
      id: Date.now().toString(),
      username: trimmedUsername,
      password: hashPassword(password),
      createdAt: new Date().toISOString()
    };

    const success = addUser(newUser);
    if (!success) {
      return res.status(500).json({ error: "Failed to create user account. Try again later." });
    }

    res.status(201).json({
      success: true,
      message: "User registered successfully."
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and return token
 */
router.post("/api/auth/login", (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const user = findUserByUsername(username.trim());
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const tokenPayload = {
      id: user.id,
      username: user.username
    };

    const token = generateToken(tokenPayload);

    res.json({
      success: true,
      token,
      user: tokenPayload
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user info
 */
router.get("/api/auth/me", authenticate, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

export default router;
