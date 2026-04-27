/**
 * Activity Event System
 *
 * Centralized event tracking and broadcast for all computer-use operations.
 * Maintains a circular buffer of the last 50 events and broadcasts each
 * new event to connected SSE clients via the existing broadcast() function.
 */

import { broadcast } from './events.js';

// ── Types ────────────────────────────────────────────

export type ActivityEventType =
  | 'document-created'
  | 'file-copied'
  | 'file-moved'
  | 'file-deleted'
  | 'directory-created'
  | 'file-read'
  | 'app-launched'
  | 'command-executed'
  | 'screenshot-taken';

export interface ActivityEvent {
  id: number;
  timestamp: string;
  type: ActivityEventType;
  description: string;
  metadata?: Record<string, string | number>;
}

// ── State ────────────────────────────────────────────

const BUFFER_SIZE = 50;

let eventIdCounter = 0;
const eventBuffer: ActivityEvent[] = [];

// ── Public API ───────────────────────────────────────

/**
 * Emit an activity event. Assigns a monotonically increasing ID,
 * stores the event in the circular buffer, and broadcasts it to
 * all connected SSE clients.
 */
export function emitActivity(
  type: ActivityEventType,
  description: string,
  metadata?: Record<string, string | number>,
): ActivityEvent {
  const event: ActivityEvent = {
    id: ++eventIdCounter,
    timestamp: new Date().toISOString(),
    type,
    description,
    metadata,
  };

  // Circular buffer: remove oldest when at capacity
  if (eventBuffer.length >= BUFFER_SIZE) {
    eventBuffer.shift();
  }
  eventBuffer.push(event);

  broadcast('activity', event);

  return event;
}

/**
 * Return the buffered activity events (up to the last 50).
 * Used to initialize new SSE clients with recent history.
 */
export function getActivityHistory(): ActivityEvent[] {
  return [...eventBuffer];
}

// ── Testing helpers ──────────────────────────────────

/**
 * Reset internal state. Only intended for use in tests.
 */
export function _resetForTesting(): void {
  eventIdCounter = 0;
  eventBuffer.length = 0;
}
