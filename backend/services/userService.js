import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "data", "users.json");

/**
 * Ensures the database directory and file exist.
 */
function initDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify([], null, 2), "utf8");
  }
}

/**
 * Retrieve all users from the JSON database.
 */
export function getUsers() {
  initDb();
  try {
    const data = fs.readFileSync(dbPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading users database:", error);
    return [];
  }
}

/**
 * Save user records to the JSON database.
 */
export function saveUsers(users) {
  initDb();
  try {
    fs.writeFileSync(dbPath, JSON.stringify(users, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("Error writing users database:", error);
    return false;
  }
}

/**
 * Find a user by their username.
 */
export function findUserByUsername(username) {
  const users = getUsers();
  return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

/**
 * Add a new user to the JSON database.
 */
export function addUser(user) {
  const users = getUsers();
  users.push(user);
  return saveUsers(users);
}
