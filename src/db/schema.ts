import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ── Assignment types ─────────────────────────────────
export const ASSIGNMENT_TYPES = [
  'quiz',
  'file-upload',
  'inline-text',
  'discussion-post',
  'external-tool',
] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const ASSIGNMENT_STATUSES = [
  'pending',
  'in-progress',
  'waiting-for-peers',
  'ready',
  'submitted',
  'failed',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// ── Tables ───────────────────────────────────────────
export const assignments = sqliteTable('assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  course: text('course').notNull(),
  courseId: text('course_id'),
  title: text('title').notNull(),
  type: text('type', { enum: ASSIGNMENT_TYPES }).notNull(),
  deadline: text('deadline').notNull(), // ISO 8601
  status: text('status', { enum: ASSIGNMENT_STATUSES }).notNull().default('pending'),
  filePath: text('file_path'),
  submissionUrl: text('submission_url'),
  lmsItemId: text('lms_item_id'), // Brightspace folder/quiz/topic ID
  instructions: text('instructions'),
  rubric: text('rubric'),
  pointsValue: integer('points_value'),
  lastAction: text('last_action'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at'),
});

export const emailLog = sqliteTable('email_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  receivedAt: text('received_at').notNull(),
  sender: text('sender').notNull(),
  subject: text('subject').notNull(),
  body: text('body'),
  classification: text('classification', {
    enum: [
      'deadline_change',
      'new_assignment',
      'grade_feedback',
      'clarification',
      'general_announcement',
    ],
  }).notNull(),
  courseTag: text('course_tag'),
  actionTaken: text('action_taken'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export const reminders = sqliteTable('reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  assignmentId: integer('assignment_id')
    .notNull()
    .references(() => assignments.id),
  intervalLabel: text('interval_label').notNull(), // '7d', '48h', '6h'
  firedAt: text('fired_at').notNull(),
});

export const actionLog = sqliteTable('action_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  assignmentId: integer('assignment_id').references(() => assignments.id),
  action: text('action').notNull(),
  details: text('details'),
  screenshotPath: text('screenshot_path'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ── Type exports ─────────────────────────────────────
export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
export type EmailLogEntry = typeof emailLog.$inferSelect;
export type NewEmailLogEntry = typeof emailLog.$inferInsert;
export type ActionLogEntry = typeof actionLog.$inferSelect;
