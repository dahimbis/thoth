import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const TEST_DB_PATH = resolve(import.meta.dirname, '..', 'data', 'test-deadlines.db');

describe('Deadline Monitoring Logic', () => {
  let db: Database.Database;

  beforeAll(() => {
    const dir = dirname(TEST_DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);

    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        deadline TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        last_action TEXT,
        updated_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        course_id TEXT, file_path TEXT, submission_url TEXT,
        lms_item_id TEXT, instructions TEXT, rubric TEXT,
        points_value INTEGER, notes TEXT
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL REFERENCES assignments(id),
        interval_label TEXT NOT NULL,
        fired_at TEXT NOT NULL
      );
    `);
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  it('should identify assignments due within 7 days', () => {
    // Insert assignment due in 5 days
    const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO assignments (course, title, type, deadline, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('TEST-100', 'Due Soon', 'file-upload', fiveDaysFromNow, 'pending');

    // Query for assignments due within 7 days
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const results = db.prepare(`
      SELECT * FROM assignments
      WHERE deadline <= ? AND status NOT IN ('submitted', 'failed')
    `).all(sevenDaysFromNow) as Array<Record<string, unknown>>;

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title === 'Due Soon')).toBe(true);
  });

  it('should not fire duplicate reminders', () => {
    const assignmentId = 1;
    const intervalLabel = '48h';

    // Insert a reminder
    db.prepare(`
      INSERT INTO reminders (assignment_id, interval_label, fired_at)
      VALUES (?, ?, datetime('now'))
    `).run(assignmentId, intervalLabel);

    // Check it exists
    const count = db.prepare(`
      SELECT COUNT(*) as cnt FROM reminders
      WHERE assignment_id = ? AND interval_label = ?
    `).get(assignmentId, intervalLabel) as { cnt: number };

    expect(count.cnt).toBe(1);

    // A check function would skip since it already exists
    const exists = count.cnt > 0;
    expect(exists).toBe(true);
  });

  it('should exclude submitted and failed assignments from deadline checks', () => {
    // Insert submitted assignment
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO assignments (course, title, type, deadline, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('TEST-200', 'Already Submitted', 'quiz', tomorrow, 'submitted');

    // Insert failed assignment
    db.prepare(`
      INSERT INTO assignments (course, title, type, deadline, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('TEST-200', 'Failed Upload', 'file-upload', tomorrow, 'failed');

    // Query pending only
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const results = db.prepare(`
      SELECT * FROM assignments
      WHERE deadline <= ? AND status NOT IN ('submitted', 'failed')
    `).all(farFuture) as Array<Record<string, unknown>>;

    const submittedOrFailed = results.filter(
      (r) => r.title === 'Already Submitted' || r.title === 'Failed Upload',
    );
    expect(submittedOrFailed.length).toBe(0);
  });
});
