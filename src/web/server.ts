import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import {
  addSSEClient,
  resolveConfirmation,
  getPendingConfirmations,
} from './events.js';
import {
  getAllAssignments,
  getPendingAssignments,
  getAssignmentById,
  updateAssignmentStatus,
} from '../db/queries.js';
import { getStudentProfile, getConfig, SCREENSHOTS_DIR } from '../config.js';
import { processAssignment } from '../workflows/submit.js';
import { fullCourseScan } from '../workflows/scan.js';
import {
  processGoogleForm,
  fillGoogleForm,
  submitGoogleForm,
  isGoogleFormUrl,
} from '../browser/pages/google-forms.js';
import { logger } from '../ui/logger.js';
import { createDocument } from '../documents/document-service.js';
import { executeFileOperation } from '../computer/file-manager.js';
import { launch } from '../computer/app-launcher.js';
import { getActivePage } from '../browser/browser.js';
import { getActivityHistory } from './activity.js';
import { getLastScreenshot } from '../browser/screenshot-stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve the dashboard HTML
  app.get('/', (_req, res) => {
    res.sendFile(resolve(__dirname, '..', '..', 'public', 'index.html'));
  });

  // Serve static assets
  app.use('/public', express.static(resolve(__dirname, '..', '..', 'public')));

  // ── SSE endpoint ─────────────────────────────────
  app.get('/api/events', (req, res) => {
    addSSEClient(res);

    // Send activity history to newly connected clients
    const history = getActivityHistory();
    if (history.length > 0) {
      const payload = `event: activity-history\ndata: ${JSON.stringify(history)}\n\n`;
      try { res.write(payload); } catch { /* client disconnected */ }
    }

    // Send the most recent screenshot to newly connected clients
    const lastScreenshot = getLastScreenshot();
    if (lastScreenshot) {
      const payload = `event: screenshot\ndata: ${JSON.stringify(lastScreenshot)}\n\n`;
      try { res.write(payload); } catch { /* client disconnected */ }
    }
  });

  // ── Dashboard data ───────────────────────────────
  app.get('/api/assignments', (_req, res) => {
    const assignments = getAllAssignments();
    res.json(assignments);
  });

  app.get('/api/assignments/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const assignment = getAssignmentById(id);
    if (!assignment) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(assignment);
  });

  app.get('/api/pending', (_req, res) => {
    res.json(getPendingAssignments());
  });

  app.get('/api/profile', (_req, res) => {
    try {
      res.json(getStudentProfile());
    } catch {
      res.json({ error: 'Profile not configured' });
    }
  });

  // ── Actions ──────────────────────────────────────

  // Track running tasks so they can be cancelled
  const runningTasks = new Map<number, AbortController>();

  app.post('/api/process/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const assignment = getAssignmentById(id);
    if (!assignment) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const controller = new AbortController();
    runningTasks.set(id, controller);

    res.json({ status: 'started', message: `Processing "${assignment.title}"` });

    // Process in background
    processAssignment(assignment).catch((err) => {
      if (controller.signal.aborted) {
        logger.info(`Task #${id} was cancelled by user`);
      } else {
        logger.error(`Background processing failed: ${err}`);
      }
    }).finally(() => {
      runningTasks.delete(id);
    });
  });

  // Cancel/stop a running task
  app.post('/api/cancel/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const controller = runningTasks.get(id);
    if (controller) {
      controller.abort();
      runningTasks.delete(id);
      updateAssignmentStatus(id, 'pending', 'Cancelled by user');
      logger.info(`Task #${id} cancelled by user`);
      res.json({ success: true, message: 'Task cancelled' });
    } else {
      // Even if no controller, reset the status if it's in-progress
      const a = getAssignmentById(id);
      if (a && a.status === 'in-progress') {
        updateAssignmentStatus(id, 'pending', 'Cancelled by user');
        res.json({ success: true, message: 'Task status reset' });
      } else {
        res.json({ success: false, message: 'No running task found for this ID' });
      }
    }
  });

  // Get list of currently running task IDs
  app.get('/api/running', (_req, res) => {
    res.json({ running: Array.from(runningTasks.keys()) });
  });

  app.post('/api/process-all', async (_req, res) => {
    const pending = getPendingAssignments();
    res.json({ status: 'started', count: pending.length });

    // Process in background
    (async () => {
      for (const a of pending) {
        try {
          await processAssignment(a);
        } catch (err) {
          logger.error(`Failed: ${err}`);
        }
      }
    })();
  });

  app.post('/api/scan', async (_req, res) => {
    res.json({ status: 'started' });

    fullCourseScan().catch((err) => {
      logger.error(`Scan failed: ${err}`);
    });
  });

  app.post('/api/skip/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const a = getAssignmentById(id);
    if (!a) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    updateAssignmentStatus(id, 'failed', 'Skipped by user');
    res.json({ status: 'skipped' });
  });

  app.post('/api/reset/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const a = getAssignmentById(id);
    if (!a) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    updateAssignmentStatus(id, 'pending', 'Reset by user');
    res.json({ status: 'reset' });
  });

  // ── Confirmation gate ────────────────────────────
  app.get('/api/confirmations', (_req, res) => {
    res.json(getPendingConfirmations());
  });

  app.post('/api/confirm/:id', (req, res) => {
    const { confirmed, response } = req.body as { confirmed: boolean; response: string };
    const resolved = resolveConfirmation(req.params.id, confirmed, response ?? '');
    if (!resolved) {
      res.status(404).json({ error: 'No pending confirmation with that ID' });
      return;
    }
    res.json({ status: 'resolved' });
  });

  // ── Google Forms ─────────────────────────────────
  app.post('/api/google-form/analyze', async (req, res) => {
    const { url } = req.body as { url: string };
    if (!url || !isGoogleFormUrl(url)) {
      res.status(400).json({ error: 'Invalid Google Form URL' });
      return;
    }

    try {
      const analysis = await processGoogleForm(url);
      res.json(analysis);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/google-form/submit', async (req, res) => {
    const { url, fields } = req.body as { url: string; fields: unknown[] };

    try {
      const fillResult = await fillGoogleForm(url, fields as any);
      if (fillResult.success) {
        const submitResult = await submitGoogleForm(url);
        res.json(submitResult);
      } else {
        res.status(500).json({ error: 'Failed to fill form' });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Document Creation ──────────────────────────────
  app.post('/api/documents/create', async (req, res) => {
    try {
      const result = await createDocument(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── File Operations ────────────────────────────────
  app.post('/api/files/mkdir', async (req, res) => {
    try {
      const result = await executeFileOperation({ operation: 'mkdir', path: req.body.path });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/files/copy', async (req, res) => {
    try {
      const result = await executeFileOperation({ operation: 'copy', path: req.body.path, destination: req.body.destination });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/files/move', async (req, res) => {
    try {
      const result = await executeFileOperation({ operation: 'move', path: req.body.path, destination: req.body.destination });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/files/delete', async (req, res) => {
    try {
      const result = await executeFileOperation({ operation: 'delete', path: req.body.path });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/files/list', async (req, res) => {
    try {
      const result = await executeFileOperation({ operation: 'list', path: req.body.path });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/files/read', async (req, res) => {
    try {
      const result = await executeFileOperation({ operation: 'read', path: req.body.path });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── App Launcher ───────────────────────────────────
  app.post('/api/apps/launch', async (req, res) => {
    try {
      const { type, target, args, timeoutMs } = req.body as { type: 'open-file' | 'open-app'; target: string; args?: string[]; timeoutMs?: number };
      const result = await launch({ type, target, args, timeoutMs });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/apps/exec', async (req, res) => {
    try {
      const { target, args, timeoutMs } = req.body as { target: string; args?: string[]; timeoutMs?: number };
      const result = await launch({ type: 'exec', target, args, timeoutMs });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Browser Status & Config ────────────────────────
  app.get('/api/browser/status', (_req, res) => {
    const config = getConfig();
    const page = getActivePage();
    const active = page !== null;
    res.json({
      active,
      headless: config.BROWSER_HEADLESS,
      url: active ? page!.url() : null,
      title: null, // title() is async; we return null here for sync response
    });
  });

  app.post('/api/browser/config', (req, res) => {
    const { headless } = req.body as { headless?: boolean };
    if (typeof headless === 'boolean') {
      // Update the config for next browser launch
      // This modifies the in-memory config; the browser must be relaunched to take effect
      (getConfig() as any).BROWSER_HEADLESS = headless;
      res.json({ success: true, headless });
    } else {
      res.status(400).json({ error: 'Missing "headless" boolean field' });
    }
  });

  // ── Screenshot Files ───────────────────────────────
  app.get('/api/screenshots/:name', (req, res) => {
    const name = req.params.name;
    // Prevent path traversal
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      res.status(400).json({ error: 'Invalid screenshot name' });
      return;
    }
    const filePath = resolve(SCREENSHOTS_DIR, name);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Screenshot not found' });
      return;
    }
    res.sendFile(filePath);
  });

  // ── Term Management ────────────────────────────────
  app.get('/api/terms', (_req, res) => {
    try {
      const { getAvailableTerms, detectCurrentTerm } = require('../scheduler/term-manager.js');
      const terms = getAvailableTerms();
      res.json(terms);
    } catch {
      // Fallback if term manager not fully wired
      res.json([{ name: 'Spring 2026', isCurrent: true }, { name: 'Summer 2026', isCurrent: false }]);
    }
  });

  app.post('/api/terms/select', (req, res) => {
    const { term } = req.body as { term: string };
    if (!term) {
      res.status(400).json({ error: 'Missing "term" field' });
      return;
    }
    // Store in memory for now (will be persisted via settings table when DB queries are wired)
    (getConfig() as any).ACTIVE_TERM = term;
    res.json({ success: true, term });
  });

  app.get('/api/terms/active', (_req, res) => {
    const config = getConfig();
    res.json({ term: config.ACTIVE_TERM || null });
  });

  // ── Notifications ──────────────────────────────────
  app.get('/api/notifications', (_req, res) => {
    const { getNotifications } = require('./notifications.js');
    res.json(getNotifications({ undismissedOnly: true }));
  });

  app.post('/api/notifications/:id/dismiss', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { dismissNotification } = require('./notifications.js');
    const dismissed = dismissNotification(id);
    if (!dismissed) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json({ success: true });
  });

  // ── Preview Gate ───────────────────────────────────
  // In-memory store for preview content (keyed by assignment ID)
  const previewStore = new Map<number, { content: string; metadata: Record<string, unknown> }>();

  app.get('/api/preview/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const preview = previewStore.get(id);
    if (!preview) {
      res.status(404).json({ error: 'No preview available for this assignment' });
      return;
    }
    res.json(preview);
  });

  app.post('/api/preview/:id/approve', (req, res) => {
    const id = parseInt(req.params.id, 10);
    // Approval is handled through the existing confirmation gate
    // This route triggers the confirmation resolution
    const confirmId = `confirm-preview-${id}`;
    const resolved = resolveConfirmation(confirmId, true, 'approved');
    res.json({ success: true, message: resolved ? 'Approved' : 'No pending confirmation found  - may already be resolved' });
  });

  app.post('/api/preview/:id/feedback', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { feedback } = req.body as { feedback: string };
    if (!feedback) {
      res.status(400).json({ error: 'Missing "feedback" field' });
      return;
    }
    const confirmId = `confirm-preview-${id}`;
    const resolved = resolveConfirmation(confirmId, false, feedback);
    res.json({ success: true, message: resolved ? 'Feedback sent' : 'No pending confirmation found' });
  });

  return app;
}

export function startWebServer(port: number = 3000): void {
  const app = createServer();

  app.listen(port, () => {
    console.log('');
    console.log(`  Dashboard: http://localhost:${port}`);
    console.log('');
  });
}
