import { createInterface } from 'readline';
import chalk from 'chalk';
import Table from 'cli-table3';
import { logger } from './logger.js';
import { type RubricCheckResult } from '../agent/writing-agent.js';

// Web mode: when set, confirmations go to the web dashboard instead of CLI
let _webConfirmationHandler: ((request: ConfirmationRequest) => Promise<{ confirmed: boolean; response: string }>) | null = null;

/** Register a web-based confirmation handler */
export function setWebConfirmationHandler(
  handler: (request: ConfirmationRequest) => Promise<{ confirmed: boolean; response: string }>,
): void {
  _webConfirmationHandler = handler;
}

/**
 * Confirmation Gate — the ONLY step that requires human interaction.
 *
 * Before any submission, present details and wait for explicit confirmation.
 * Accepted: 'submit', 'yes', 'confirm', 'approved', 'go ahead'
 */

export interface ConfirmationRequest {
  title: string;
  course: string;
  type: string;
  deadline: string;
  targetUrl: string;
  fileInfo?: string; // filename + size OR first 300 chars of text
  rubricCheck?: RubricCheckResult[];
  previewText?: string;
  quizSummary?: string;
}

const ACCEPTED_RESPONSES = ['submit', 'yes', 'confirm', 'approved', 'go ahead', 'y'];

/**
 * Present submission details and wait for user confirmation.
 * Returns true if user confirms, false if they want changes.
 * Returns the user's response text for handling modification requests.
 */
export async function requestConfirmation(
  request: ConfirmationRequest,
): Promise<{ confirmed: boolean; response: string }> {
  // If web mode is active, route to the web dashboard
  if (_webConfirmationHandler) {
    return _webConfirmationHandler(request);
  }

  // CLI mode: Build the confirmation display
  const hoursRemaining = getHoursRemaining(request.deadline);

  console.log('');
  console.log(chalk.cyan('┌─────────────────────────────────────────────────────┐'));
  console.log(chalk.cyan('│') + chalk.bold.white('  SUBMISSION CONFIRMATION REQUIRED                    ') + chalk.cyan('│'));
  console.log(chalk.cyan('├─────────────────────────────────────────────────────┤'));
  console.log(chalk.cyan('│') + ' Assignment : ' + chalk.white(request.title.padEnd(37)) + chalk.cyan('│'));
  console.log(chalk.cyan('│') + ' Course     : ' + chalk.white(request.course.padEnd(37)) + chalk.cyan('│'));
  console.log(chalk.cyan('│') + ' Type       : ' + chalk.white(request.type.padEnd(37)) + chalk.cyan('│'));
  console.log(chalk.cyan('│') + ' Deadline   : ' + chalk.white(request.deadline.substring(0, 19).padEnd(20)) + formatTimeRemaining(hoursRemaining).padEnd(17) + chalk.cyan('│'));
  console.log(chalk.cyan('│') + ' Target URL : ' + chalk.dim(truncate(request.targetUrl, 37)) + chalk.cyan('│'));

  if (request.fileInfo) {
    console.log(chalk.cyan('│') + ' File/Text  : ' + chalk.white(truncate(request.fileInfo, 37)) + chalk.cyan('│'));
  }

  console.log(chalk.cyan('└─────────────────────────────────────────────────────┘'));

  // Rubric check table
  if (request.rubricCheck && request.rubricCheck.length > 0) {
    console.log('');
    console.log(chalk.bold('Rubric Check:'));

    const table = new Table({
      head: ['Criterion', 'Status', 'Notes'],
      colWidths: [25, 8, 25],
      style: { head: ['cyan'] },
    });

    for (const check of request.rubricCheck) {
      table.push([
        truncate(check.criterion, 23),
        check.passed ? chalk.green('PASS') : chalk.red('FAIL'),
        truncate(check.notes, 23),
      ]);
    }

    console.log(table.toString());
  }

  // Preview text
  if (request.previewText) {
    console.log('');
    console.log(chalk.bold('Preview (first 300 chars):'));
    console.log(chalk.dim(request.previewText.substring(0, 300)));
    console.log(chalk.dim('...'));
  }

  // Quiz summary
  if (request.quizSummary) {
    console.log('');
    console.log(chalk.bold('Quiz Summary:'));
    console.log(chalk.dim(request.quizSummary));
  }

  console.log('');
  console.log(chalk.yellow('Awaiting confirmation to submit.'));
  console.log(chalk.dim('Type: submit / yes / confirm   |   Or describe changes needed'));
  console.log('');

  // Wait for user input
  const response = await prompt('> ');
  const trimmed = response.trim().toLowerCase();

  if (ACCEPTED_RESPONSES.includes(trimmed)) {
    logger.success('Submission confirmed by user');
    return { confirmed: true, response: trimmed };
  }

  logger.info(`User requested changes: ${response}`);
  return { confirmed: false, response };
}

/**
 * Emergency notification when quiz is auto-submitted due to timer.
 */
export function notifyAutoSubmit(title: string, course: string, summary: string): void {
  console.log('');
  console.log(chalk.bgRed.white.bold(' ⚠ AUTO-SUBMITTED '));
  console.log(chalk.red(`Quiz "${title}" (${course}) was auto-submitted due to critical timer.`));
  console.log('');
  console.log(chalk.bold('Answer Summary:'));
  console.log(summary);
  console.log('');
}

// ── Helpers ──────────────────────────────────────────

function prompt(query: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function getHoursRemaining(deadline: string): number {
  const deadlineDate = new Date(deadline);
  const now = new Date();
  return (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function formatTimeRemaining(hours: number): string {
  if (hours < 0) return chalk.red('OVERDUE');
  if (hours < 1) return chalk.red(`${Math.round(hours * 60)}min left`);
  if (hours < 6) return chalk.red(`${Math.round(hours)}h left`);
  if (hours < 48) return chalk.yellow(`${Math.round(hours)}h left`);
  return chalk.green(`${Math.round(hours / 24)}d left`);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}
