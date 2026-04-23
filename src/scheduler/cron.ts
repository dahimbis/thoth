import cron, { type ScheduledTask } from 'node-cron';
import { checkDeadlines } from './deadline-monitor.js';
import { logTaskQueue } from './task-queue.js';
import { startEmailPolling, stopEmailPolling } from '../email/poller.js';
import { checkForStaleTasks } from '../workflows/error-recovery.js';
import { getAllAssignments } from '../db/queries.js';
import { logger } from '../ui/logger.js';

let deadlineTask: ScheduledTask | null = null;
let emailTimer: NodeJS.Timeout | null = null;

/**
 * Start all scheduled tasks.
 */
export function startScheduler(): void {
  logger.info('Starting scheduler...');

  // Check deadlines every 30 minutes
  deadlineTask = cron.schedule('*/30 * * * *', () => {
    logger.debug('Running deadline check...');
    try {
      const alerts = checkDeadlines();
      if (alerts.length > 0) {
        logger.warn(`${alerts.length} new deadline alerts`);
      }
    } catch (err) {
      logger.error(`Deadline check failed: ${err}`);
    }
  });

  // Check for stale tasks every hour
  cron.schedule('0 * * * *', () => {
    logger.debug('Checking for stale tasks...');
    try {
      const assignments = getAllAssignments();
      checkForStaleTasks(assignments);
    } catch (err) {
      logger.error(`Stale task check failed: ${err}`);
    }
  });

  // Log task queue every 2 hours
  cron.schedule('0 */2 * * *', () => {
    logTaskQueue();
  });

  // Start email polling
  emailTimer = startEmailPolling();

  logger.success('Scheduler started');
}

/**
 * Stop all scheduled tasks.
 */
export function stopScheduler(): void {
  if (deadlineTask) {
    deadlineTask.stop();
    deadlineTask = null;
  }
  stopEmailPolling(emailTimer);
  emailTimer = null;
  logger.info('Scheduler stopped');
}
