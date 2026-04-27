import chalk from 'chalk';
import Table from 'cli-table3';
import { getAllAssignments, getPendingAssignments } from '../db/queries.js';
import { type Assignment } from '../db/schema.js';

/**
 * Display a dashboard of all tracked assignments.
 */
export function showDashboard(): void {
  const assignments = getAllAssignments();

  if (assignments.length === 0) {
    console.log(chalk.dim('No assignments tracked yet.'));
    return;
  }

  console.log('');
  console.log(chalk.bold.cyan('═══ Thoth Assignment Dashboard ═══'));
  console.log('');

  const table = new Table({
    head: ['#', 'Course', 'Title', 'Type', 'Deadline', 'Status', 'Time Left'],
    colWidths: [4, 18, 25, 14, 20, 14, 12],
    style: { head: ['cyan'] },
  });

  for (const a of assignments) {
    table.push([
      a.id,
      truncate(a.course, 16),
      truncate(a.title, 23),
      a.type,
      a.deadline.substring(0, 16),
      formatStatus(a.status),
      formatTimeRemaining(a.deadline),
    ]);
  }

  console.log(table.toString());

  const pending = assignments.filter((a) => !['submitted', 'failed'].includes(a.status));
  const submitted = assignments.filter((a) => a.status === 'submitted');
  const failed = assignments.filter((a) => a.status === 'failed');

  console.log('');
  console.log(
    `${chalk.yellow(pending.length)} pending  |  ` +
    `${chalk.green(submitted.length)} submitted  |  ` +
    `${chalk.red(failed.length)} failed  |  ` +
    `${chalk.dim(assignments.length)} total`,
  );
  console.log('');
}

/**
 * Show a compact status line (for monitoring output).
 */
export function showStatusLine(): void {
  const pending = getPendingAssignments();

  if (pending.length === 0) {
    console.log(chalk.green('All assignments submitted.'));
    return;
  }

  // Find next deadline
  const next = pending[0]; // Already sorted by deadline
  if (next) {
    console.log(
      chalk.dim(`[STATUS] Next: "${next.title}" (${next.course})  - ${next.status}  - due ${formatTimeRemaining(next.deadline)}`),
    );
  }
}

// ── Helpers ──────────────────────────────────────────

function formatStatus(status: string): string {
  switch (status) {
    case 'pending':
      return chalk.yellow('pending');
    case 'in-progress':
      return chalk.blue('in-progress');
    case 'waiting-for-peers':
      return chalk.magenta('wait-peers');
    case 'ready':
      return chalk.cyan('ready');
    case 'submitted':
      return chalk.green('submitted');
    case 'failed':
      return chalk.red('failed');
    default:
      return status;
  }
}

function formatTimeRemaining(deadline: string): string {
  const deadlineDate = new Date(deadline);
  const now = new Date();
  const hours = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hours < 0) return chalk.red('OVERDUE');
  if (hours < 1) return chalk.red(`${Math.round(hours * 60)}m`);
  if (hours < 6) return chalk.red(`${Math.round(hours)}h`);
  if (hours < 48) return chalk.yellow(`${Math.round(hours)}h`);
  if (hours < 168) return chalk.white(`${Math.round(hours / 24)}d`);
  return chalk.dim(`${Math.round(hours / 24)}d`);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 2) + '..';
}
