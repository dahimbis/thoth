import { loadConfig, DATA_DIR, OUTPUTS_DIR, SCREENSHOTS_DIR } from '../config.js';
import { initializeDatabase } from '../db/index.js';
import { authenticate } from '../browser/auth.js';
import { fullCourseScan } from './scan.js';
import { checkDeadlines } from '../scheduler/deadline-monitor.js';
import { logTaskQueue } from '../scheduler/task-queue.js';
import { showDashboard } from '../ui/dashboard.js';
import { checkForStaleTasks } from './error-recovery.js';
import { getAllAssignments } from '../db/queries.js';
import { logger } from '../ui/logger.js';
import { existsSync, mkdirSync } from 'fs';

/**
 * Startup Sequence — runs ONCE at agent start.
 *
 * Step 1: Load config + ensure directories
 * Step 2: Initialize database
 * Step 3: Authenticate with Brightspace
 * Step 4: Full course scan
 * Step 5: Check deadlines + show dashboard
 * Step 6: Begin monitoring loop
 */
export async function runStartupSequence(): Promise<void> {
  const startTime = Date.now();
  logger.info('═══ Thoth Agent — Startup Sequence ═══');

  // Step 1: Config + directories
  logger.info('Step 1: Loading configuration...');
  const config = loadConfig();

  for (const dir of [DATA_DIR, OUTPUTS_DIR, SCREENSHOTS_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  logger.success('Configuration loaded');

  // Step 2: Database
  logger.info('Step 2: Initializing database...');
  initializeDatabase();
  logger.success('Database ready');

  // Step 3: Authentication
  logger.info('Step 3: Authenticating with Brightspace...');
  await authenticate();
  logger.success('Authentication complete');

  // Step 4: Full scan
  logger.info('Step 4: Scanning all courses...');
  const scanResult = await fullCourseScan();
  logger.success(
    `Scan complete: ${scanResult.courses.length} courses, ${scanResult.totalDiscovered} new assignments`,
  );

  // Step 5: Post-scan checks
  logger.info('Step 5: Checking deadlines...');
  const alerts = checkDeadlines();
  if (alerts.length > 0) {
    logger.warn(`${alerts.length} deadline alerts generated`);
  }

  // Check for stale tasks
  const allAssignments = getAllAssignments();
  checkForStaleTasks(allAssignments);

  // Show dashboard
  showDashboard();
  logTaskQueue();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.success(`Startup complete in ${elapsed}s. ${scanResult.totalDiscovered} assignments found.`);
}
