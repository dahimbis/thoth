import { createInterface, type Interface } from 'readline';
import chalk from 'chalk';
import { showDashboard } from './dashboard.js';
import { logger } from './logger.js';
import { getAllAssignments, getPendingAssignments, getAssignmentById, updateAssignmentStatus } from '../db/queries.js';
import { getStudentProfile } from '../config.js';
import { processAssignment } from '../workflows/submit.js';
import { fullCourseScan } from '../workflows/scan.js';
import { processGoogleForm, fillGoogleForm, submitGoogleForm, isGoogleFormUrl, type FormAnalysis } from '../browser/pages/google-forms.js';
import { requestConfirmation } from './confirmation.js';
import { logTaskQueue } from '../scheduler/task-queue.js';

/**
 * Interactive CLI Control Panel
 *
 * Gives the user full control over the agent:
 * - View dashboard and task queue
 * - Process specific assignments
 * - Fill Google Forms
 * - Rescan courses
 * - View/edit profile
 * - Manual overrides
 */

let rl: Interface | null = null;

export async function startControlPanel(): Promise<void> {
  rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('thoth> '),
  });

  showBanner();
  showHelp();

  rl.prompt();

  rl.on('line', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl?.prompt();
      return;
    }

    try {
      await handleCommand(trimmed);
    } catch (err) {
      logger.error(`Command error: ${err}`);
    }

    rl?.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.dim('Control panel closed.'));
  });
}

function showBanner(): void {
  console.log('');
  console.log(chalk.cyan('  ╔════════════════════════════════════════� -'));
  console.log(chalk.cyan('  ║') + chalk.bold.white('      THOTH  - Interactive Control       ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚════════════════════════════════════════╝'));
  console.log('');
}

function showHelp(): void {
  console.log(chalk.bold('Commands:'));
  console.log('');
  console.log(chalk.cyan('  dashboard') + '          Show all tracked assignments');
  console.log(chalk.cyan('  queue') + '              Show the task priority queue');
  console.log(chalk.cyan('  profile') + '            Show your student profile');
  console.log(chalk.cyan('  scan') + '               Rescan all courses for new assignments');
  console.log(chalk.cyan('  process <id>') + '       Process a specific assignment by ID');
  console.log(chalk.cyan('  process all') + '        Process all pending assignments');
  console.log(chalk.cyan('  status <id>') + '        Show details for a specific assignment');
  console.log(chalk.cyan('  skip <id>') + '          Mark an assignment as skipped (failed)');
  console.log(chalk.cyan('  reset <id>') + '         Reset an assignment to pending');
  console.log(chalk.cyan('  form <url>') + '         Fill out a Google Form');
  console.log(chalk.cyan('  help') + '               Show this help message');
  console.log(chalk.cyan('  exit') + '               Exit the agent');
  console.log('');
}

async function handleCommand(input: string): Promise<void> {
  const parts = input.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? '';
  const arg = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help':
    case 'h':
    case '?':
      showHelp();
      break;

    case 'dashboard':
    case 'dash':
    case 'd':
      showDashboard();
      break;

    case 'queue':
    case 'q':
      logTaskQueue();
      break;

    case 'profile':
    case 'p':
      showProfile();
      break;

    case 'scan':
    case 's':
      await handleScan();
      break;

    case 'process':
    case 'run':
    case 'r':
      await handleProcess(arg);
      break;

    case 'status':
    case 'info':
    case 'i':
      handleStatus(arg);
      break;

    case 'skip':
      handleSkip(arg);
      break;

    case 'reset':
      handleReset(arg);
      break;

    case 'form':
    case 'f':
      await handleGoogleForm(arg);
      break;

    case 'list':
    case 'ls':
      handleList();
      break;

    case 'exit':
    case 'quit':
    case 'bye':
      console.log(chalk.dim('Goodbye.'));
      process.exit(0);

    default:
      // Check if it's a Google Form URL directly
      if (isGoogleFormUrl(input)) {
        await handleGoogleForm(input);
      } else {
        console.log(chalk.red(`Unknown command: "${cmd}". Type "help" for available commands.`));
      }
  }
}

// ── Command Handlers ─────────────────────────────────

function showProfile(): void {
  const profile = getStudentProfile();

  console.log('');
  console.log(chalk.bold('Student Profile:'));
  console.log(`  Name      : ${chalk.white(profile.fullName)}`);
  console.log(`  Email     : ${chalk.white(profile.email)}`);
  console.log(`  ID        : ${chalk.white(profile.studentId)}`);
  console.log(`  Phone     : ${chalk.white(profile.phone || chalk.dim('not set'))}`);
  console.log(`  Major     : ${chalk.white(profile.major || chalk.dim('not set'))}`);
  console.log(`  Year      : ${chalk.white(profile.year || chalk.dim('not set'))}`);
  console.log(`  School    : ${chalk.white(profile.institution)}`);
  console.log('');
  console.log(chalk.dim('  Edit these in your .env file.'));
  console.log('');
}

async function handleScan(): Promise<void> {
  console.log(chalk.yellow('Rescanning all courses...'));
  const result = await fullCourseScan();
  console.log(chalk.green(`Scan complete: ${result.totalDiscovered} new, ${result.totalExisting} existing`));
  showDashboard();
}

async function handleProcess(arg: string): Promise<void> {
  if (!arg) {
    console.log(chalk.red('Usage: process <id> or process all'));
    return;
  }

  if (arg.toLowerCase() === 'all') {
    const pending = getPendingAssignments();
    if (pending.length === 0) {
      console.log(chalk.green('No pending assignments to process.'));
      return;
    }

    console.log(chalk.yellow(`Processing ${pending.length} pending assignments...`));
    for (const assignment of pending) {
      try {
        await processAssignment(assignment);
      } catch (err) {
        logger.error(`Failed to process "${assignment.title}": ${err}`);
      }
    }
    return;
  }

  const id = parseInt(arg, 10);
  if (isNaN(id)) {
    console.log(chalk.red(`Invalid ID: "${arg}". Use a number.`));
    return;
  }

  const assignment = getAssignmentById(id);
  if (!assignment) {
    console.log(chalk.red(`Assignment #${id} not found.`));
    return;
  }

  console.log(chalk.yellow(`Processing: "${assignment.title}" (${assignment.course})`));
  await processAssignment(assignment);
}

function handleStatus(arg: string): void {
  const id = parseInt(arg, 10);
  if (isNaN(id)) {
    console.log(chalk.red('Usage: status <id>'));
    return;
  }

  const a = getAssignmentById(id);
  if (!a) {
    console.log(chalk.red(`Assignment #${id} not found.`));
    return;
  }

  console.log('');
  console.log(chalk.bold(`Assignment #${a.id}`));
  console.log(`  Title       : ${chalk.white(a.title)}`);
  console.log(`  Course      : ${chalk.white(a.course)}`);
  console.log(`  Type        : ${chalk.white(a.type)}`);
  console.log(`  Deadline    : ${chalk.white(a.deadline)}`);
  console.log(`  Status      : ${chalk.white(a.status)}`);
  console.log(`  LMS Item ID : ${chalk.dim(a.lmsItemId ?? 'N/A')}`);
  console.log(`  File Path   : ${chalk.dim(a.filePath ?? 'N/A')}`);
  console.log(`  Last Action : ${chalk.dim(a.lastAction ?? 'N/A')}`);
  console.log(`  Points      : ${chalk.dim(String(a.pointsValue ?? 'N/A'))}`);
  if (a.notes) {
    console.log(`  Notes       : ${chalk.dim(a.notes.substring(0, 200))}`);
  }
  console.log(`  Created     : ${chalk.dim(a.createdAt ?? '')}`);
  console.log(`  Updated     : ${chalk.dim(a.updatedAt ?? '')}`);
  console.log('');
}

function handleSkip(arg: string): void {
  const id = parseInt(arg, 10);
  if (isNaN(id)) {
    console.log(chalk.red('Usage: skip <id>'));
    return;
  }

  const a = getAssignmentById(id);
  if (!a) {
    console.log(chalk.red(`Assignment #${id} not found.`));
    return;
  }

  updateAssignmentStatus(id, 'failed', 'Manually skipped by user');
  console.log(chalk.yellow(`Marked "${a.title}" as skipped/failed.`));
}

function handleReset(arg: string): void {
  const id = parseInt(arg, 10);
  if (isNaN(id)) {
    console.log(chalk.red('Usage: reset <id>'));
    return;
  }

  const a = getAssignmentById(id);
  if (!a) {
    console.log(chalk.red(`Assignment #${id} not found.`));
    return;
  }

  updateAssignmentStatus(id, 'pending', 'Reset to pending by user');
  console.log(chalk.green(`Reset "${a.title}" to pending.`));
}

function handleList(): void {
  const all = getAllAssignments();
  if (all.length === 0) {
    console.log(chalk.dim('No assignments tracked.'));
    return;
  }

  console.log('');
  for (const a of all) {
    const statusColor =
      a.status === 'submitted' ? chalk.green :
      a.status === 'failed' ? chalk.red :
      a.status === 'in-progress' ? chalk.blue :
      chalk.yellow;

    console.log(
      `  ${chalk.dim(`#${a.id}`)} ${statusColor(`[${a.status}]`)} ${a.title} ${chalk.dim(`(${a.course})`)}`,
    );
  }
  console.log('');
}

async function handleGoogleForm(url: string): Promise<void> {
  if (!url) {
    console.log(chalk.red('Usage: form <google-form-url>'));
    console.log(chalk.dim('  Example: form https://docs.google.com/forms/d/e/xxx/viewform'));
    return;
  }

  if (!isGoogleFormUrl(url)) {
    console.log(chalk.red('That does not look like a Google Form URL.'));
    console.log(chalk.dim('  Expected: https://docs.google.com/forms/...'));
    return;
  }

  console.log(chalk.yellow('Analyzing Google Form...'));

  // Step 1: Extract and analyze
  const analysis = await processGoogleForm(url);

  // Step 2: Preview
  console.log('');
  console.log(chalk.bold(`Form: ${analysis.title}`));
  if (analysis.description) {
    console.log(chalk.dim(analysis.description.substring(0, 200)));
  }
  console.log('');
  console.log(chalk.bold('Proposed answers:'));
  console.log('');

  for (const field of analysis.fields) {
    const source = field.autoFilled
      ? chalk.green('[PROFILE]')
      : field.aiGenerated
        ? chalk.blue('[AI]')
        : chalk.yellow('[EMPTY]');

    const value = field.proposedValue
      ? chalk.white(field.proposedValue.substring(0, 60))
      : chalk.dim('(no answer)');

    const req = field.required ? chalk.red('*') : ' ';

    console.log(`  ${req} ${source} ${chalk.cyan(field.label)}`);
    console.log(`           ${value}`);
    if (field.type === 'radio' || field.type === 'checkbox' || field.type === 'dropdown') {
      console.log(`           ${chalk.dim(`Options: ${field.options.join(', ')}`)}`);
    }
    console.log('');
  }

  // Step 3: Confirmation
  const { confirmed, response } = await requestConfirmation({
    title: analysis.title,
    course: 'Google Form',
    type: 'google-form',
    deadline: 'N/A',
    targetUrl: url,
    fileInfo: `${analysis.totalFields} fields (${analysis.autoFilledCount} auto-filled, ${analysis.aiFilledCount} AI)`,
  });

  if (!confirmed) {
    console.log(chalk.yellow('Form submission cancelled.'));
    console.log(chalk.dim(`Your feedback: ${response}`));
    return;
  }

  // Step 4: Fill and submit
  console.log(chalk.yellow('Filling form...'));
  const fillResult = await fillGoogleForm(url, analysis.fields);

  if (fillResult.success) {
    console.log(chalk.yellow('Submitting form...'));
    const submitResult = await submitGoogleForm(url);

    if (submitResult.success) {
      console.log(chalk.green('Google Form submitted successfully!'));
    } else {
      console.log(chalk.red('Form submission may have failed. Check the screenshot.'));
      console.log(chalk.dim(`Screenshot: ${submitResult.screenshotPath}`));
    }
  }
}

export function stopControlPanel(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
