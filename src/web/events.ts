import { type Response } from 'express';

/**
 * Server-Sent Events (SSE) hub.
 *
 * All connected browser clients receive real-time updates:
 * - Log messages
 * - Assignment status changes
 * - Confirmation gate requests
 * - Scan progress
 */

type SSEClient = {
  id: string;
  res: Response;
};

const clients: SSEClient[] = [];
let clientIdCounter = 0;

export function addSSEClient(res: Response): string {
  const id = `client-${++clientIdCounter}`;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`);

  clients.push({ id, res });

  res.on('close', () => {
    const index = clients.findIndex((c) => c.id === id);
    if (index !== -1) clients.splice(index, 1);
  });

  return id;
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {
      // Client disconnected
    }
  }
}

// ── Typed Event Emitters ─────────────────────────────

export function emitLog(level: string, message: string, meta?: Record<string, string>): void {
  broadcast('log', {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
}

export function emitAssignmentUpdate(id: number, status: string, lastAction: string): void {
  broadcast('assignment', { id, status, lastAction });
}

export function emitScanProgress(course: string, step: string, count: number): void {
  broadcast('scan', { course, step, count });
}

// ── Confirmation Gate via Web ────────────────────────

interface PendingConfirmation {
  id: string;
  request: unknown;
  resolve: (result: { confirmed: boolean; response: string }) => void;
}

const pendingConfirmations: Map<string, PendingConfirmation> = new Map();
let confirmationIdCounter = 0;

/**
 * Request confirmation from the web UI.
 * Returns a promise that resolves when the user responds.
 */
export function requestWebConfirmation(
  request: unknown,
): Promise<{ confirmed: boolean; response: string }> {
  const id = `confirm-${++confirmationIdCounter}`;

  return new Promise((resolve) => {
    pendingConfirmations.set(id, { id, request, resolve });
    broadcast('confirmation', { id, request });
  });
}

/**
 * Resolve a pending confirmation (called by the API route).
 */
export function resolveConfirmation(
  id: string,
  confirmed: boolean,
  response: string,
): boolean {
  const pending = pendingConfirmations.get(id);
  if (!pending) return false;

  pending.resolve({ confirmed, response });
  pendingConfirmations.delete(id);
  return true;
}

export function getPendingConfirmations(): Array<{ id: string; request: unknown }> {
  return Array.from(pendingConfirmations.values()).map((p) => ({
    id: p.id,
    request: p.request,
  }));
}
