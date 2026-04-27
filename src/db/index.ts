import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { DB_PATH } from '../config.js';
import * as schema from './schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (_db) return _db;

  // Ensure data directory exists
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _sqlite = new Database(DB_PATH);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');

  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

/** Run raw SQL for initial table creation (used before migrations are set up) */
export function initializeDatabase(): void {
  const db = getDb();

  // Create tables if they don't exist
  const sqlite = _sqlite!;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course TEXT NOT NULL,
      course_id TEXT,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('quiz','file-upload','inline-text','discussion-post','external-tool')),
      deadline TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in-progress','waiting-for-peers','ready','submitted','failed')),
      file_path TEXT,
      submission_url TEXT,
      lms_item_id TEXT,
      instructions TEXT,
      rubric TEXT,
      points_value INTEGER,
      last_action TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      sender TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT,
      classification TEXT NOT NULL CHECK(classification IN ('deadline_change','new_assignment','grade_feedback','clarification','general_announcement')),
      course_tag TEXT,
      action_taken TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL REFERENCES assignments(id),
      interval_label TEXT NOT NULL,
      fired_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER REFERENCES assignments(id),
      action TEXT NOT NULL,
      details TEXT,
      screenshot_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add term column if it doesn't exist (migration for existing databases)
  try {
    sqlite.exec(`ALTER TABLE assignments ADD COLUMN term TEXT;`);
  } catch {
    // Column already exists  - ignore
  }
}

export { schema };
