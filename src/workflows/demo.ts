import { initializeDatabase } from '../db/index.js';
import { insertAssignment, getAllAssignments, logAction } from '../db/queries.js';
import { logger } from '../ui/logger.js';

/**
 * Demo mode — seeds the database with realistic mock assignments
 * so you can test the dashboard, UI, and workflows without
 * connecting to Brightspace or having any API keys.
 */

export function seedDemoData(): void {
  initializeDatabase();

  // Don't double-seed
  const existing = getAllAssignments();
  if (existing.length > 0) {
    logger.info(`Demo database already has ${existing.length} assignments`);
    return;
  }

  logger.info('Seeding demo data...');

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  const demoAssignments = [
    // ── CS-101 Introduction to Computer Science ────
    {
      course: 'CS-101 Intro to Computer Science',
      courseId: '12001',
      title: 'Homework 3: Data Structures',
      type: 'file-upload' as const,
      deadline: new Date(now + 2 * day).toISOString(),
      status: 'pending' as const,
      pointsValue: 100,
      lmsItemId: 'drop-301',
      submissionUrl: 'https://brightspace.nyu.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=301&ou=12001',
      instructions: 'Implement a binary search tree with insert, delete, and search operations. Include unit tests. Submit as a .zip file containing your Python code and a README.',
      rubric: 'Correctness (40pts) | Code Quality (20pts) | Tests (20pts) | Documentation (20pts)',
      lastAction: 'discovered',
    },
    {
      course: 'CS-101 Intro to Computer Science',
      courseId: '12001',
      title: 'Quiz 4: Algorithms',
      type: 'quiz' as const,
      deadline: new Date(now + 5 * day).toISOString(),
      status: 'pending' as const,
      pointsValue: 50,
      lmsItemId: 'quiz-401',
      lastAction: 'discovered',
    },
    {
      course: 'CS-101 Intro to Computer Science',
      courseId: '12001',
      title: 'Discussion: Ethics in AI',
      type: 'discussion-post' as const,
      deadline: new Date(now + 3 * day).toISOString(),
      status: 'pending' as const,
      pointsValue: 20,
      lmsItemId: '5-10',
      instructions: 'Read the assigned article on algorithmic bias. Post your response (minimum 200 words) and reply to at least 2 peers.',
      lastAction: 'discovered',
    },

    // ── MATH-201 Linear Algebra ────────────────────
    {
      course: 'MATH-201 Linear Algebra',
      courseId: '12002',
      title: 'Problem Set 6',
      type: 'file-upload' as const,
      deadline: new Date(now + 1 * day).toISOString(),
      status: 'pending' as const,
      pointsValue: 80,
      lmsItemId: 'drop-602',
      submissionUrl: 'https://brightspace.nyu.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=602&ou=12002',
      instructions: 'Complete problems 1-8 from Chapter 6. Show all work. Submit as PDF.',
      rubric: 'Correctness (60pts) | Work shown (20pts)',
      lastAction: 'discovered',
    },
    {
      course: 'MATH-201 Linear Algebra',
      courseId: '12002',
      title: 'Midterm Exam',
      type: 'quiz' as const,
      deadline: new Date(now + 7 * day).toISOString(),
      status: 'pending' as const,
      pointsValue: 200,
      lmsItemId: 'quiz-mid-202',
      lastAction: 'discovered',
    },

    // ── HIST-150 Modern World History ──────────────
    {
      course: 'HIST-150 Modern World History',
      courseId: '12003',
      title: 'Essay: Industrial Revolution Impact',
      type: 'file-upload' as const,
      deadline: new Date(now + 4 * day).toISOString(),
      status: 'pending' as const,
      pointsValue: 150,
      lmsItemId: 'drop-150-essay',
      submissionUrl: 'https://brightspace.nyu.edu/d2l/lms/dropbox/user/folder_submit_files.d2l?db=150&ou=12003',
      instructions: 'Write a 1500-2000 word essay analyzing the social and economic impacts of the Industrial Revolution on urban populations. Use at least 5 scholarly sources. APA format.',
      rubric: 'Thesis (20pts) | Evidence (30pts) | Analysis (40pts) | Citations (30pts) | Grammar (30pts)',
      lastAction: 'discovered',
    },
    {
      course: 'HIST-150 Modern World History',
      courseId: '12003',
      title: 'Discussion: Colonialism Debate',
      type: 'discussion-post' as const,
      deadline: new Date(now + 6 * day).toISOString(),
      status: 'pending' as const,
      pointsValue: 25,
      lmsItemId: '8-15',
      instructions: 'Take a position on whether colonialism had any lasting positive effects. Support with evidence. Reply to 1 peer who holds the opposite view.',
      lastAction: 'discovered',
    },

    // ── Already submitted ones ─────────────────────
    {
      course: 'CS-101 Intro to Computer Science',
      courseId: '12001',
      title: 'Homework 2: Sorting Algorithms',
      type: 'file-upload' as const,
      deadline: new Date(now - 3 * day).toISOString(),
      status: 'submitted' as const,
      pointsValue: 100,
      lmsItemId: 'drop-201',
      lastAction: 'Submitted via API',
      notes: 'Received confirmation. Score: pending.',
    },
    {
      course: 'MATH-201 Linear Algebra',
      courseId: '12002',
      title: 'Problem Set 5',
      type: 'file-upload' as const,
      deadline: new Date(now - 5 * day).toISOString(),
      status: 'submitted' as const,
      pointsValue: 80,
      lmsItemId: 'drop-502',
      lastAction: 'Submitted via browser',
      notes: 'Graded: 72/80',
    },

    // ── One failed ─────────────────────────────────
    {
      course: 'HIST-150 Modern World History',
      courseId: '12003',
      title: 'Reading Response Week 3',
      type: 'inline-text' as const,
      deadline: new Date(now - 1 * day).toISOString(),
      status: 'failed' as const,
      pointsValue: 10,
      lmsItemId: 'inline-303',
      lastAction: 'Upload failed — session expired',
      notes: 'File saved at outputs/Demo_HIST-150_Reading_Response_Week_3.docx',
    },
  ];

  for (const a of demoAssignments) {
    insertAssignment(a);
  }

  // Add some action log entries
  logAction(1, 'discovered', 'Found during course scan');
  logAction(8, 'processing_started', 'Type: file-upload');
  logAction(8, 'content_generated', 'Draft: 847 words');
  logAction(8, 'submitted', 'Submitted via API. Receipt confirmed.');
  logAction(9, 'processing_started', 'Type: file-upload');
  logAction(9, 'submitted', 'Submitted via browser upload');

  const count = getAllAssignments().length;
  logger.success(`Demo data seeded: ${count} assignments`);
}
