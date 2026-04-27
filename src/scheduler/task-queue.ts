import { getPendingAssignments } from '../db/queries.js';
import { logger } from '../ui/logger.js';
import type { Assignment } from '../db/schema.js';

/**
 * Task Queue  - prioritized by deadline proximity.
 * Re-sorted after every database update.
 */

export function getNextTask(): Assignment | null {
  const pending = getPendingAssignments();

  if (pending.length === 0) {
    return null;
  }

  // Already sorted by deadline ASC from the query
  // But also prioritize by status: in-progress > pending > waiting-for-peers > ready
  const statusPriority: Record<string, number> = {
    'in-progress': 0,
    'pending': 1,
    'ready': 2,
    'waiting-for-peers': 3,
  };

  pending.sort((a, b) => {
    // First: items already in-progress
    const aPri = statusPriority[a.status] ?? 99;
    const bPri = statusPriority[b.status] ?? 99;
    if (aPri !== bPri) return aPri - bPri;

    // Then: earliest deadline
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  return pending[0] ?? null;
}

export function getTaskQueue(): Assignment[] {
  const pending = getPendingAssignments();

  pending.sort((a, b) => {
    const aTime = new Date(a.deadline).getTime();
    const bTime = new Date(b.deadline).getTime();
    return aTime - bTime;
  });

  return pending;
}

export function logTaskQueue(): void {
  const queue = getTaskQueue();

  if (queue.length === 0) {
    logger.info('Task queue is empty  - all assignments submitted');
    return;
  }

  logger.info(`Task queue: ${queue.length} items`);
  for (const [i, task] of queue.entries()) {
    const deadline = new Date(task.deadline);
    const hoursLeft = Math.round((deadline.getTime() - Date.now()) / (1000 * 60 * 60));
    logger.debug(`  ${i + 1}. [${task.status}] ${task.title} (${task.course})  - ${hoursLeft}h left`);
  }
}
