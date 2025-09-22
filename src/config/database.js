import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

let dbInstance;

export function ensureDatabase() {
  if (dbInstance) return dbInstance;
  
  // Use different database paths for development vs production
  const isProduction = process.env.NODE_ENV === 'production';
  const dbPath = isProduction 
    ? path.join('/tmp', 'server-data.sqlite') // Vercel uses /tmp
    : path.join(process.cwd(), 'server-data.sqlite');
  
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS results (
      job_id TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      address TEXT,
      unit TEXT,
      meter_status TEXT,
      property_status TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      status_captured_at TEXT,
      PRIMARY KEY (job_id, row_index)
    );
  `);
  
  // Add the status_captured_at column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE results ADD COLUMN status_captured_at TEXT;`);
  } catch (e) {
    // Column already exists, ignore the error
  }
  
  dbInstance = db;
  return dbInstance;
}
