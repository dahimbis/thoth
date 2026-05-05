import { runStartupSequence } from './workflows/startup.js';
import { startScheduler, stopScheduler } from './scheduler/cron.js';
import { getNextTask } from './scheduler/task-queue.js';
import { processAssignment } from './workflows/submit.js';
import { closeBrowser } from './browser/browser.js';
import { startScreenshotStream, stopScreenshotStream } from './browser/screenshot-stream.js';
import { closeDb, initializeDatabase } from './db/index.js';
import { showDashboard } from './ui/dashboard.js';
import { startControlPanel, stopControlPanel } from './ui/control-panel.js';
import { setWebConfirmationHandler } from './ui/confirmation.js';
import { logger, setLogLevel, setSSEEmitter } from './ui/logger.js';
import { startWebServer } from './web/server.js';
import { emitLog, requestWebConfirmation } from './web/events.js';
import { isAgentRunning, setAgentRunning } from './web/server.js';
import { setDemoMode, isDemoMode, loadConfig } from './config.js';
import { seedDemoData } from './workflows/demo.js';
import { existsSync, mkdirSync } from 'fs';
import { DATA_DIR, OUTPUTS_DIR, SCREENSHOTS_DIR, getScreenshotInterval } from './config.js';

/**
 * Thoth  - Autonomous LMS Agent
 *
 * Entry point. Supports multiple operation modes:
 *
 *   npm start                     Web dashboard (default) on http://localhost:3000
 *   npm start -- --demo           Demo mode  - no credentials needed, uses mock data
 *   npm start -- --cli            CLI-only mode (no web server)
 *   npm start -- --interactive    CLI interactive control panel
 *   npm start -- --scan-only      Scan courses and exit
 *   npm start -- --dashboard      Show CLI dashboard and exit
 *   npm start -- --auto           Full auto: scan + process all + exit
 *   npm start -- --debug          Enable debug logging
 *   npm start -- --port 8080      Custom port for web dashboard
 */

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const debugMode = args.includes('--debug') || args.includes('-d');
  const scanOnly = args.includes('--scan-only');
  const dashboardOnly = args.includes('--dashboard');
  const interactive = args.includes('--interactive') || args.includes('-i');
  const autoMode = args.includes('--auto') || args.includes('-a');
  const cliOnly = args.includes('--cli');
  const demoMode = args.includes('--demo');
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1] ?? '3000', 10) : 3000;

  if (debugMode) {
    setLogLevel('debug');
  }

  if (demoMode) {
    setDemoMode(true);
  }

  console.log('');
  console.log('  ╔════════════════════════════════════════� -');
  console.log('  ║          THOTH  - LMS Agent             ║');
  console.log('  ║   Autonomous Brightspace Automation    ║');
  console.log('  ║         VIP Research Project           ║');
  console.log('  ╚════════════════════════════════════════╝');
  console.log('');

  if (demoMode) {
    console.log('  ** DEMO MODE  - using mock data, no credentials required **');
    console.log('');
  }

  try {
    // ── Ensure directories exist ───────────────────
    for (const dir of [DATA_DIR, OUTPUTS_DIR, SCREENSHOTS_DIR]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // ── Demo mode: seed data and start dashboard ───
    if (demoMode) {
      loadConfig(); // Uses demo config, won't throw
      initializeDatabase();
      seedDemoData();

      // Wire up SSE
      setSSEEmitter((level, message, meta) => {
        emitLog(level, message, meta);
      });
      setWebConfirmationHandler((request) => {
        return requestWebConfirmation(request);
      });

      startWebServer(port);

      // Start screenshot stream for dashboard live view
      startScreenshotStream({ intervalMs: getScreenshotInterval() });

      logger.success('Demo mode ready. Open the dashboard to explore.');

      // Simulate some log activity so the dashboard looks alive
      setTimeout(() => logger.info('Deadline check: 3 assignments due within 7 days'), 2000);
      setTimeout(() => logger.info('Next deadline: "Problem Set 6" (MATH-201)  - 24h left', { course: 'MATH-201' }), 4000);
      setTimeout(() => logger.warn('DEADLINE: "Problem Set 6" due in 24 hours', { course: 'MATH-201', status: 'WARNING' }), 6000);

      // Keep alive
      await new Promise<void>((resolve) => {
        process.on('SIGINT', () => resolve());
        process.on('SIGTERM', () => resolve());
      });
      return;
    }

    // ── Normal mode: validate config ───────────────
    // This will throw with a helpful error if .env isn't filled in
    loadConfig();

    // ── Web Dashboard (default mode) ───────────────
    if (!cliOnly && !scanOnly && !dashboardOnly) {
      setSSEEmitter((level, message, meta) => {
        emitLog(level, message, meta);
      });
      setWebConfirmationHandler((request) => {
        return requestWebConfirmation(request);
      });
      startWebServer(port);

      // Start screenshot stream for dashboard live view
      startScreenshotStream({ intervalMs: getScreenshotInterval() });
    }

    // ── Startup ────────────────────────────────────
    await runStartupSequence();

    // Dashboard-only mode (CLI)
    if (dashboardOnly) {
      showDashboard();
      return;
    }

    // Scan-only mode
    if (scanOnly) {
      logger.info('Scan-only mode. Exiting.');
      return;
    }

    // Auto mode: process everything and exit
    if (autoMode) {
      logger.info('Auto mode: processing all pending tasks...');
      startScheduler();
      await processTaskQueue();
      logger.info('Auto mode complete.');
      return;
    }

    // CLI interactive mode
    if (interactive || cliOnly) {
      logger.info('CLI mode. Type "help" for commands.');
      startScheduler();
      await startControlPanel();
      return;
    }

    // Default: web mode — start paused, wait for user to click Start
    startScheduler();
    logger.info('Agent is paused. Click "Start Agent" in the dashboard to begin processing.');
    logger.info(`Open http://localhost:${port} in your browser.`);
    logger.info('Press Ctrl+C to exit.');

    // Poll for agent start, then process tasks
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(async () => {
        if (isAgentRunning()) {
          clearInterval(checkInterval);
          logger.info('Agent started. Processing tasks...');
          await processTaskQueue();
          logger.success('All tasks processed. Dashboard is running.');
        }
      }, 2000);

      process.on('SIGINT', () => {
        clearInterval(checkInterval);
        logger.info('Shutdown signal received');
        resolve();
      });
      process.on('SIGTERM', () => {
        clearInterval(checkInterval);
        logger.info('Shutdown signal received');
        resolve();
      });
    });

  } catch (err) {
    logger.error(`Fatal error: ${err}`);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

/**
 * Process all tasks in the queue, in priority order.
 */
async function processTaskQueue(): Promise<void> {
  let processed = 0;

  while (true) {
    const task = getNextTask();
    if (!task) break;

    logger.info(`Processing task ${processed + 1}: "${task.title}" (${task.course})`, {
      course: task.course,
      task: task.title,
    });

    try {
      await processAssignment(task);
      processed++;
    } catch (err) {
      logger.error(`Task failed: ${err}`, { course: task.course, task: task.title });
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  if (processed > 0) {
    logger.success(`Processed ${processed} tasks`);
  } else {
    logger.info('No pending tasks to process');
  }
}

/**
 * Graceful shutdown.
 */
async function shutdown(): Promise<void> {
  logger.info('Shutting down...');

  stopControlPanel();
  stopScheduler();
  stopScreenshotStream();

  try {
    await closeBrowser();
  } catch {
    // Best effort
  }

  try {
    closeDb();
  } catch {
    // Best effort
  }

  logger.info('Shutdown complete');
}

// ── Run ──────────────────────────────────────────────
main();
