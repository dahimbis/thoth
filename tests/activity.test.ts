import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  emitActivity,
  getActivityHistory,
  _resetForTesting,
  ActivityEvent,
  ActivityEventType,
} from '../src/web/activity.js';

// Mock the broadcast function so we don't need a real SSE setup
vi.mock('../src/web/events.js', () => ({
  broadcast: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────

const ALL_EVENT_TYPES: ActivityEventType[] = [
  'document-created',
  'file-copied',
  'file-moved',
  'file-deleted',
  'directory-created',
  'file-read',
  'app-launched',
  'command-executed',
  'screenshot-taken',
];

/** Pick a random event type */
function randomEventType(): ActivityEventType {
  return ALL_EVENT_TYPES[Math.floor(Math.random() * ALL_EVENT_TYPES.length)]!;
}

/** Generate a random alphanumeric string */
function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** Generate random metadata */
function randomMetadata(): Record<string, string | number> | undefined {
  if (Math.random() < 0.3) return undefined;
  const meta: Record<string, string | number> = {};
  const numKeys = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numKeys; i++) {
    const key = `key${i}`;
    meta[key] = Math.random() < 0.5 ? randomString(5) : Math.floor(Math.random() * 1000);
  }
  return meta;
}

// ── Setup ────────────────────────────────────────────

beforeEach(() => {
  _resetForTesting();
});

// ── Unit Tests ───────────────────────────────────────

describe('Activity Event System  - Unit Tests', () => {
  it('should emit an event with correct fields', () => {
    const event = emitActivity('document-created', 'Created report.pdf', { size: 1024 });

    expect(event.id).toBe(1);
    expect(event.type).toBe('document-created');
    expect(event.description).toBe('Created report.pdf');
    expect(event.metadata).toEqual({ size: 1024 });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should assign incrementing IDs', () => {
    const e1 = emitActivity('file-copied', 'Copied file A');
    const e2 = emitActivity('file-moved', 'Moved file B');
    const e3 = emitActivity('file-deleted', 'Deleted file C');

    expect(e1.id).toBe(1);
    expect(e2.id).toBe(2);
    expect(e3.id).toBe(3);
  });

  it('should store events in history', () => {
    emitActivity('app-launched', 'Launched notepad');
    emitActivity('command-executed', 'Ran npm test');

    const history = getActivityHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.type).toBe('app-launched');
    expect(history[1]!.type).toBe('command-executed');
  });

  it('should return a copy of history (not the internal buffer)', () => {
    emitActivity('file-read', 'Read config.json');
    const h1 = getActivityHistory();
    const h2 = getActivityHistory();

    expect(h1).not.toBe(h2);
    expect(h1).toEqual(h2);
  });

  it('should cap history at 50 events', () => {
    for (let i = 0; i < 60; i++) {
      emitActivity('file-read', `Read file ${i}`);
    }

    const history = getActivityHistory();
    expect(history).toHaveLength(50);
    // Should contain the most recent 50 (IDs 11-60)
    expect(history[0]!.id).toBe(11);
    expect(history[49]!.id).toBe(60);
  });

  it('should handle events with no metadata', () => {
    const event = emitActivity('screenshot-taken', 'Captured screenshot');
    expect(event.metadata).toBeUndefined();
  });

  it('should reset cleanly for testing', () => {
    emitActivity('file-deleted', 'Deleted temp');
    _resetForTesting();

    expect(getActivityHistory()).toHaveLength(0);

    const event = emitActivity('file-read', 'Read again');
    expect(event.id).toBe(1);
  });
});

// ── Property-Based Tests ─────────────────────────────

const PBT_ITERATIONS = 20;

describe('Activity Event System  - Property-Based Tests', () => {
  /**
   * **Validates: Requirements 6.3**
   * Property 9: Activity event IDs are monotonically increasing for any sequence of emitted events.
   */
  describe('Property: Activity event IDs are monotonically increasing', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`monotonic IDs iteration ${i + 1}`, () => {
        _resetForTesting();

        const count = 2 + Math.floor(Math.random() * 30);
        const events: ActivityEvent[] = [];

        for (let j = 0; j < count; j++) {
          const event = emitActivity(
            randomEventType(),
            randomString(5 + Math.floor(Math.random() * 50)),
            randomMetadata(),
          );
          events.push(event);
        }

        // Verify each ID is strictly greater than the previous
        for (let j = 1; j < events.length; j++) {
          expect(events[j]!.id).toBeGreaterThan(events[j - 1]!.id);
        }
      });
    }
  });

  /**
   * **Validates: Requirements 6.1**
   * Property 10: Activity event schema compliance  - all events have required fields
   * (id, timestamp, type, description).
   */
  describe('Property: Activity event schema compliance', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`schema compliance iteration ${i + 1}`, () => {
        _resetForTesting();

        const count = 1 + Math.floor(Math.random() * 10);

        for (let j = 0; j < count; j++) {
          const type = randomEventType();
          const description = randomString(5 + Math.floor(Math.random() * 50));
          const metadata = randomMetadata();

          const event = emitActivity(type, description, metadata);

          // id is a positive number
          expect(typeof event.id).toBe('number');
          expect(event.id).toBeGreaterThan(0);

          // timestamp is a valid ISO 8601 string
          expect(typeof event.timestamp).toBe('string');
          const parsed = new Date(event.timestamp);
          expect(parsed.toISOString()).toBe(event.timestamp);

          // type is a valid ActivityEventType
          expect(ALL_EVENT_TYPES).toContain(event.type);

          // description is a non-empty string
          expect(typeof event.description).toBe('string');
          expect(event.description.length).toBeGreaterThan(0);
        }
      });
    }
  });

  /**
   * **Validates: Requirements 6.4**
   * Property 11: Activity history buffer is bounded at 50 and contains the most recent events.
   */
  describe('Property: Activity history buffer is bounded at 50 and contains the most recent events', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`buffer bounded iteration ${i + 1}`, () => {
        _resetForTesting();

        const count = 50 + Math.floor(Math.random() * 100); // 50 to 149 events
        const allEvents: ActivityEvent[] = [];

        for (let j = 0; j < count; j++) {
          const event = emitActivity(
            randomEventType(),
            randomString(5 + Math.floor(Math.random() * 50)),
            randomMetadata(),
          );
          allEvents.push(event);
        }

        const history = getActivityHistory();

        // Buffer is bounded at 50
        expect(history.length).toBeLessThanOrEqual(50);

        // Contains exactly 50 events when more than 50 were emitted
        expect(history.length).toBe(50);

        // The history contains the most recent 50 events
        const expectedRecent = allEvents.slice(-50);
        expect(history.map((e) => e.id)).toEqual(expectedRecent.map((e) => e.id));

        // IDs in history are monotonically increasing
        for (let j = 1; j < history.length; j++) {
          expect(history[j]!.id).toBeGreaterThan(history[j - 1]!.id);
        }
      });
    }
  });
});
