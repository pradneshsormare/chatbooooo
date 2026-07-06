import { verifyToken } from "../utils/auth.js";

/**
 * Middleware to authenticate requests.
 * Extracts Bearer token from the Authorization header and verifies it.
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: No authentication token provided."
    });
  }

  const token = authHeader.split(" ")[1];
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Authentication token is invalid or expired."
    });
  }

  // Attach decoded user info to request
  req.user = decoded;
  next();
}
