import { discoverCourses, detectCurrentTerm, type CourseInfo } from '../browser/pages/home.js';
import { scanAssignments } from '../browser/pages/assignments.js';
import { scanQuizzes } from '../browser/pages/quizzes.js';
import { scanDiscussions } from '../browser/pages/discussions.js';
import {
  insertAssignment,
  getAssignmentByLmsId,
  logAction,
} from '../db/queries.js';
import { type AssignmentType } from '../db/schema.js';
import { logger } from '../ui/logger.js';

/**
 * Full Course Scan Workflow
 *
 * For each enrolled course:
 * 1. Scan assignments (dropbox folders)
 * 2. Scan quizzes
 * 3. Scan discussion topics
 * 4. Populate the database with discovered items
 *
 * Returns: total count of newly discovered assignments
 */
export async function fullCourseScan(): Promise<{
  term: string;
  courses: CourseInfo[];
  totalDiscovered: number;
  totalExisting: number;
}> {
  // Detect term
  const term = await detectCurrentTerm();
  logger.info(`Current term: ${term}`);

  // Discover courses
  const courses = await discoverCourses();

  if (courses.length === 0) {
    logger.warn('No courses found');
    return { term, courses: [], totalDiscovered: 0, totalExisting: 0 };
  }

  let totalDiscovered = 0;
  let totalExisting = 0;

  // Scan each course
  for (const course of courses) {
    logger.info(`Scanning course: ${course.name}`, { course: course.name });

    try {
      // Scan assignments
      const assignments = await scanAssignments(course.orgUnitId, course.name);
      for (const a of assignments) {
        const result = await upsertAssignment(course, a.title, 'file-upload', a.deadline, a.lmsItemId, a.submissionUrl, a.pointsValue);
        if (result === 'new') totalDiscovered++;
        else totalExisting++;
      }

      // Scan quizzes
      const quizzes = await scanQuizzes(course.orgUnitId, course.name);
      for (const q of quizzes) {
        const result = await upsertAssignment(course, q.title, 'quiz', q.deadline, q.lmsItemId, undefined, q.pointsValue);
        if (result === 'new') totalDiscovered++;
        else totalExisting++;
      }

      // Scan discussions
      const discussions = await scanDiscussions(course.orgUnitId, course.name);
      for (const d of discussions) {
        const result = await upsertAssignment(course, d.title, 'discussion-post', d.deadline, d.lmsItemId, undefined, null);
        if (result === 'new') totalDiscovered++;
        else totalExisting++;
      }

      logger.success(`Scan complete for ${course.name}`, { course: course.name });
    } catch (err) {
      logger.error(`Failed to scan ${course.name}: ${err}`, { course: course.name });
      logAction(null, 'scan_error', `${course.name}: ${err}`);
    }
  }

  logger.success(`Full scan complete: ${totalDiscovered} new, ${totalExisting} existing`);
  return { term, courses, totalDiscovered, totalExisting };
}

/**
 * Scan a single course (used when a new assignment is detected via email).
 */
export async function scanSingleCourse(orgUnitId: string, courseName: string): Promise<number> {
  const course: CourseInfo = { name: courseName, orgUnitId, url: '' };
  let discovered = 0;

  const assignments = await scanAssignments(orgUnitId, courseName);
  for (const a of assignments) {
    const result = await upsertAssignment(course, a.title, 'file-upload', a.deadline, a.lmsItemId, a.submissionUrl, a.pointsValue);
    if (result === 'new') discovered++;
  }

  const quizzes = await scanQuizzes(orgUnitId, courseName);
  for (const q of quizzes) {
    const result = await upsertAssignment(course, q.title, 'quiz', q.deadline, q.lmsItemId, undefined, q.pointsValue);
    if (result === 'new') discovered++;
  }

  return discovered;
}

/**
 * Insert or skip an assignment. Returns 'new' or 'existing'.
 */
async function upsertAssignment(
  course: CourseInfo,
  title: string,
  type: AssignmentType,
  deadline: string,
  lmsItemId: string,
  submissionUrl?: string,
  pointsValue?: number | null,
): Promise<'new' | 'existing'> {
  // Check if already tracked
  if (lmsItemId) {
    const existing = getAssignmentByLmsId(lmsItemId);
    if (existing) return 'existing';
  }

  insertAssignment({
    course: course.name,
    courseId: course.orgUnitId,
    title,
    type,
    deadline,
    status: 'pending',
    lmsItemId,
    submissionUrl,
    pointsValue: pointsValue ?? undefined,
    lastAction: 'discovered',
  });

  logger.debug(`New: ${title} (${type})`, { course: course.name });
  logAction(null, 'assignment_discovered', `${course.name}: ${title} (${type})`);

  return 'new';
}
