import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fallbackHistoryPath = path.join(__dirname, "..", "data", "search_history.json");
const usersPath = path.join(__dirname, "..", "data", "users.json");

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/tradebot";

let pool = null;
let useFallback = false;

try {
  pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 2000 // 2 seconds timeout to fail quickly if Postgres is not running
  });
} catch (e) {
  useFallback = true;
}

/**
 * Initializes the database tables if they do not exist.
 */
export async function initDatabase() {
  try {
    const client = await pool.connect();
    
    // Create users table (migrated from JSON)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create search_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS search_history (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        query TEXT NOT NULL,
        symbol VARCHAR(20),
        summary TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("[db] PostgreSQL tables initialized successfully.");
    client.release();
  } catch (error) {
    useFallback = true;
    console.log("=============================================================");
    console.log("[db] PostgreSQL connection failed. Falling back to local JSON database!");
    console.log("[db] Connection Details:", connectionString.replace(/:[^:@\n]+@/, ":****@"));
    console.log("[db] Local database paths:");
    console.log(`     - Users: ${usersPath}`);
    console.log(`     - History: ${fallbackHistoryPath}`);
    console.log("=============================================================");
    
    // Ensure fallback folder and files exist
    const dir = path.dirname(fallbackHistoryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(fallbackHistoryPath)) {
      fs.writeFileSync(fallbackHistoryPath, JSON.stringify([]));
    }
    if (!fs.existsSync(usersPath)) {
      fs.writeFileSync(usersPath, JSON.stringify([]));
    }
  }
}

/**
 * SQL-to-JSON query broker proxy.
 * Routes requests to PG pool or JSON files based on connection status.
 */
export async function query(text, params) {
  if (useFallback) {
    return handleFallbackQuery(text, params);
  }
  return pool.query(text, params);
}

/**
 * Lightweight query broker for JSON fallback.
 */
async function handleFallbackQuery(text, params) {
  const cleanText = text.replace(/\s+/g, " ").trim();

  const readJson = (filePath) => {
    if (!fs.existsSync(filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return [];
    }
  };

  const writeJson = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  };

  // 1. Find user by username
  if (cleanText.startsWith("SELECT * FROM users WHERE LOWER(username)")) {
    const username = params[0].toLowerCase();
    const users = readJson(usersPath);
    const user = users.find(u => u.username.toLowerCase() === username);
    return { rows: user ? [user] : [] };
  }

  // 2. Insert user
  if (cleanText.startsWith("INSERT INTO users")) {
    const [id, username, password] = params;
    const users = readJson(usersPath);
    const newUser = { id, username, password, created_at: new Date().toISOString() };
    users.push(newUser);
    writeJson(usersPath, users);
    return { rowCount: 1 };
  }

  // 3. Select history
  if (cleanText.startsWith("SELECT id, query, symbol, summary, created_at FROM search_history")) {
    const userId = params[0];
    const history = readJson(fallbackHistoryPath);
    const userHistory = history
      .filter(h => h.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);
    return { rows: userHistory };
  }

  // 4. Insert history
  if (cleanText.startsWith("INSERT INTO search_history")) {
    const [userId, queryText, symbol, summary] = params;
    const history = readJson(fallbackHistoryPath);
    const newEntry = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      user_id: userId,
      query: queryText,
      symbol,
      summary,
      created_at: new Date().toISOString()
    };
    history.push(newEntry);
    writeJson(fallbackHistoryPath, history);
    return { rowCount: 1 };
  }

  // 5. Delete specific history entry
  if (cleanText.startsWith("DELETE FROM search_history WHERE id = $1 AND user_id = $2")) {
    const [id, userId] = params;
    const history = readJson(fallbackHistoryPath);
    const index = history.findIndex(h => String(h.id) === String(id) && h.user_id === userId);
    if (index === -1) return { rowCount: 0 };
    const deleted = history.splice(index, 1);
    writeJson(fallbackHistoryPath, history);
    return { rowCount: 1, rows: deleted };
  }

  // 6. Clear history for user
  if (cleanText.startsWith("DELETE FROM search_history WHERE user_id = $1")) {
    const userId = params[0];
    const history = readJson(fallbackHistoryPath);
    const remaining = history.filter(h => h.user_id !== userId);
    writeJson(fallbackHistoryPath, remaining);
    return { rowCount: history.length - remaining.length };
  }

  throw new Error(`Unsupported fallback query: ${cleanText}`);
}

const db = {
  query,
  connect: async () => {
    if (useFallback) {
      return {
        query,
        release: () => {}
      };
    }
    return pool.connect();
  }
};

export default db;
