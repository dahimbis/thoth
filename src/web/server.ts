import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
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
import { getStudentProfile } from '../config.js';
import { processAssignment } from '../workflows/submit.js';
import { fullCourseScan } from '../workflows/scan.js';
import {
  processGoogleForm,
  fillGoogleForm,
  submitGoogleForm,
  isGoogleFormUrl,
} from '../browser/pages/google-forms.js';
import { logger } from '../ui/logger.js';

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
  app.post('/api/process/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const assignment = getAssignmentById(id);
    if (!assignment) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json({ status: 'started', message: `Processing "${assignment.title}"` });

    // Process in background
    processAssignment(assignment).catch((err) => {
      logger.error(`Background processing failed: ${err}`);
    });
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
