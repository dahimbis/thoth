import { getPendingAssignments, hasReminderFired, recordReminder } from '../db/queries.js';
import { logger } from '../ui/logger.js';

/**
 * Deadline Monitor — checks for upcoming deadlines and fires reminders.
 *
 * Intervals:
 *   7 days before  -> informational reminder
 *   48 hours before -> escalation, begin drafting if still pending
 *   6 hours before  -> urgent alert, verify submission status
 *
 * Never fires the same reminder twice for the same assignment + interval.
 */

export interface DeadlineAlert {
  assignmentId: number;
  course: string;
  title: string;
  deadline: string;
  hoursRemaining: number;
  severity: 'info' | 'warning' | 'urgent';
  intervalLabel: string;
}

export function checkDeadlines(): DeadlineAlert[] {
  const assignments = getPendingAssignments();
  const now = new Date();
  const alerts: DeadlineAlert[] = [];

  for (const assignment of assignments) {
    const deadline = new Date(assignment.deadline);
    const hoursRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Skip if already past
    if (hoursRemaining < 0) continue;

    // Check each interval
    const intervals: Array<{ hours: number; label: string; severity: 'info' | 'warning' | 'urgent' }> = [
      { hours: 168, label: '7d', severity: 'info' },
      { hours: 48, label: '48h', severity: 'warning' },
      { hours: 6, label: '6h', severity: 'urgent' },
    ];

    for (const interval of intervals) {
      if (hoursRemaining <= interval.hours && !hasReminderFired(assignment.id, interval.label)) {
        recordReminder(assignment.id, interval.label);

        const alert: DeadlineAlert = {
          assignmentId: assignment.id,
          course: assignment.course,
          title: assignment.title,
          deadline: assignment.deadline,
          hoursRemaining: Math.round(hoursRemaining),
          severity: interval.severity,
          intervalLabel: interval.label,
        };

        alerts.push(alert);
        logAlert(alert);
      }
    }
  }

  return alerts;
}

function logAlert(alert: DeadlineAlert): void {
  const msg = `DEADLINE: "${alert.title}" (${alert.course}) due in ${formatHours(alert.hoursRemaining)}`;

  switch (alert.severity) {
    case 'urgent':
      logger.error(msg, { course: alert.course, task: alert.title, status: 'URGENT' });
      break;
    case 'warning':
      logger.warn(msg, { course: alert.course, task: alert.title, status: 'WARNING' });
      break;
    default:
      logger.info(msg, { course: alert.course, task: alert.title, status: 'reminder' });
  }
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
