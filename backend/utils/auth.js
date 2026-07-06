import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_tradebot_key_2026";

/**
 * Hash a password using PBKDF2 with a unique salt.
 * Returns salt:hash format.
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored salted PBKDF2 hash.
 */
export function verifyPassword(password, storedPassword) {
  if (!storedPassword || !storedPassword.includes(":")) return false;
  const [salt, originalHash] = storedPassword.split(":");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return hash === originalHash;
}

/**
 * Generate a cryptographically signed token representing a user session.
 * Standard format is: base64Payload.signature
 */
export function generateToken(payload) {
  // Token expires in 24 hours
  const payloadWithExpiry = {
    ...payload,
    exp: Date.now() + 24 * 60 * 60 * 1000
  };
  const base64Payload = Buffer.from(JSON.stringify(payloadWithExpiry)).toString("base64");
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(base64Payload)
    .digest("hex");
  return `${base64Payload}.${signature}`;
}

/**
 * Verify a cryptographically signed token and return the payload.
 * Returns null if token is expired, invalid, or signature does not match.
 */
export function verifyToken(token) {
  try {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [base64Payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(base64Payload)
      .digest("hex");

    if (signature !== expectedSignature) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(base64Payload, "base64").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) {
      return null; // Expired
    }

    return payload;
  } catch (error) {
    return null;
  }
}
