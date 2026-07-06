import pool from "./db.js";

/**
 * Find a user by their username (case insensitive).
 */
export async function findUserByUsername(username) {
  try {
    const res = await pool.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER($1)",
      [username.trim()]
    );
    return res.rows[0] || null;
  } catch (error) {
    console.error("Error finding user by username:", error);
    throw error;
  }
}

/**
 * Add a new user to the PostgreSQL database.
 */
export async function addUser(user) {
  try {
    await pool.query(
      "INSERT INTO users (id, username, password) VALUES ($1, $2, $3)",
      [user.id, user.username, user.password]
    );
    return true;
  } catch (error) {
    console.error("Error adding user:", error);
    return false;
  }
}
