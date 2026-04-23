import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// Use a separate test database
const TEST_DB_PATH = resolve(import.meta.dirname, '..', 'data', 'test.db');

describe('Database Schema', () => {
  let db: Database.Database;

  beforeAll(() => {
    const dir = dirname(TEST_DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);

    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create tables
    db.exec(`
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
        classification TEXT NOT NULL,
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
    `);
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  it('should create assignments table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('assignments');
  });

  it('should create all required tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('assignments');
    expect(tableNames).toContain('email_log');
    expect(tableNames).toContain('reminders');
    expect(tableNames).toContain('action_log');
  });

  it('should insert and retrieve an assignment', () => {
    const stmt = db.prepare(`
      INSERT INTO assignments (course, title, type, deadline, status, last_action)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      'CS-101',
      'Homework 1',
      'file-upload',
      '2026-05-01T23:59:00Z',
      'pending',
      'discovered',
    );

    expect(result.lastInsertRowid).toBeGreaterThan(0);

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
    expect(assignment).toBeDefined();
    expect(assignment.course).toBe('CS-101');
    expect(assignment.title).toBe('Homework 1');
    expect(assignment.type).toBe('file-upload');
    expect(assignment.status).toBe('pending');
  });

  it('should enforce type constraint', () => {
    const stmt = db.prepare(`
      INSERT INTO assignments (course, title, type, deadline)
      VALUES (?, ?, ?, ?)
    `);

    expect(() =>
      stmt.run('CS-101', 'Bad Assignment', 'invalid-type', '2026-05-01T23:59:00Z'),
    ).toThrow();
  });

  it('should enforce status constraint', () => {
    const stmt = db.prepare(`
      INSERT INTO assignments (course, title, type, deadline, status)
      VALUES (?, ?, ?, ?, ?)
    `);

    expect(() =>
      stmt.run('CS-101', 'Bad Status', 'quiz', '2026-05-01T23:59:00Z', 'invalid-status'),
    ).toThrow();
  });

  it('should update assignment status', () => {
    const insert = db.prepare(`
      INSERT INTO assignments (course, title, type, deadline, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = insert.run('CS-202', 'Quiz 1', 'quiz', '2026-05-15T12:00:00Z', 'pending');

    const update = db.prepare(`
      UPDATE assignments SET status = ?, last_action = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    update.run('submitted', 'Submitted via API', result.lastInsertRowid);

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
    expect(assignment.status).toBe('submitted');
    expect(assignment.last_action).toBe('Submitted via API');
    expect(assignment.updated_at).toBeDefined();
  });

  it('should insert and query action log', () => {
    // First insert an assignment to reference
    const assignmentResult = db.prepare(`
      INSERT INTO assignments (course, title, type, deadline)
      VALUES (?, ?, ?, ?)
    `).run('CS-303', 'Project', 'file-upload', '2026-06-01T23:59:00Z');

    const logStmt = db.prepare(`
      INSERT INTO action_log (assignment_id, action, details)
      VALUES (?, ?, ?)
    `);

    logStmt.run(assignmentResult.lastInsertRowid, 'processing_started', 'Type: file-upload');
    logStmt.run(assignmentResult.lastInsertRowid, 'content_generated', 'Draft complete');
    logStmt.run(assignmentResult.lastInsertRowid, 'submitted', 'Via API');

    const logs = db.prepare('SELECT * FROM action_log WHERE assignment_id = ? ORDER BY id').all(assignmentResult.lastInsertRowid) as Array<Record<string, unknown>>;
    expect(logs.length).toBe(3);
    expect(logs[0]!.action).toBe('processing_started');
    expect(logs[2]!.action).toBe('submitted');
  });

  it('should track reminders without duplicates', () => {
    const assignmentResult = db.prepare(`
      INSERT INTO assignments (course, title, type, deadline)
      VALUES (?, ?, ?, ?)
    `).run('CS-404', 'Essay', 'inline-text', '2026-04-30T23:59:00Z');

    const assignmentId = assignmentResult.lastInsertRowid;

    // Insert a reminder
    db.prepare(`INSERT INTO reminders (assignment_id, interval_label, fired_at) VALUES (?, ?, datetime('now'))`).run(assignmentId, '7d');

    // Check it exists
    const reminder = db.prepare('SELECT * FROM reminders WHERE assignment_id = ? AND interval_label = ?').get(assignmentId, '7d');
    expect(reminder).toBeDefined();

    // Check a different interval doesn't exist
    const noReminder = db.prepare('SELECT * FROM reminders WHERE assignment_id = ? AND interval_label = ?').get(assignmentId, '48h');
    expect(noReminder).toBeUndefined();
  });
});
