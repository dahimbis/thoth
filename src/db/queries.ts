import { eq, and, lte, not, asc, desc, inArray } from 'drizzle-orm';
import { getDb } from './index.js';
import {
  assignments,
  emailLog,
  reminders,
  actionLog,
  type Assignment,
  type NewAssignment,
  type AssignmentStatus,
  type NewEmailLogEntry,
} from './schema.js';

// ── Assignment CRUD ──────────────────────────────────

export function insertAssignment(data: NewAssignment): Assignment {
  const db = getDb();
  const result = db.insert(assignments).values(data).returning().get();
  return result;
}

export function updateAssignmentStatus(
  id: number,
  status: AssignmentStatus,
  lastAction: string,
  notes?: string,
): void {
  const db = getDb();
  db.update(assignments)
    .set({
      status,
      lastAction,
      notes: notes ?? undefined,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(assignments.id, id))
    .run();
}

export function updateAssignment(
  id: number,
  data: Partial<Omit<NewAssignment, 'id'>>,
): void {
  const db = getDb();
  db.update(assignments)
    .set({
      ...data,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(assignments.id, id))
    .run();
}

export function getAssignmentById(id: number): Assignment | undefined {
  const db = getDb();
  return db.select().from(assignments).where(eq(assignments.id, id)).get();
}

export function getAssignmentByLmsId(lmsItemId: string): Assignment | undefined {
  const db = getDb();
  return db
    .select()
    .from(assignments)
    .where(eq(assignments.lmsItemId, lmsItemId))
    .get();
}

export function getAllAssignments(): Assignment[] {
  const db = getDb();
  return db.select().from(assignments).orderBy(asc(assignments.deadline)).all();
}

export function getPendingAssignments(): Assignment[] {
  const db = getDb();
  return db
    .select()
    .from(assignments)
    .where(
      inArray(assignments.status, ['pending', 'in-progress', 'waiting-for-peers', 'ready']),
    )
    .orderBy(asc(assignments.deadline))
    .all();
}

export function getAssignmentsDueBefore(isoDate: string): Assignment[] {
  const db = getDb();
  return db
    .select()
    .from(assignments)
    .where(
      and(
        lte(assignments.deadline, isoDate),
        not(inArray(assignments.status, ['submitted', 'failed'])),
      ),
    )
    .orderBy(asc(assignments.deadline))
    .all();
}

// ── Action Log ───────────────────────────────────────

export function logAction(
  assignmentId: number | null,
  action: string,
  details?: string,
  screenshotPath?: string,
): void {
  const db = getDb();
  db.insert(actionLog)
    .values({
      assignmentId,
      action,
      details,
      screenshotPath,
    })
    .run();
}

// ── Email Log ────────────────────────────────────────

export function insertEmailLog(data: NewEmailLogEntry): void {
  const db = getDb();
  db.insert(emailLog).values(data).run();
}

// ── Reminders ────────────────────────────────────────

export function hasReminderFired(assignmentId: number, intervalLabel: string): boolean {
  const db = getDb();
  const result = db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.assignmentId, assignmentId),
        eq(reminders.intervalLabel, intervalLabel),
      ),
    )
    .get();
  return result !== undefined;
}

export function recordReminder(assignmentId: number, intervalLabel: string): void {
  const db = getDb();
  db.insert(reminders)
    .values({
      assignmentId,
      intervalLabel,
      firedAt: new Date().toISOString(),
    })
    .run();
}
