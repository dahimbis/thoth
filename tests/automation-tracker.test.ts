import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  emitBrowserAction,
  _resetTrackerForTesting,
  type BrowserActionType,
} from '../src/browser/automation-tracker.js';

vi.mock('../src/web/events.js', () => ({
  broadcast: vi.fn(),
}));

beforeEach(() => {
  _resetTrackerForTesting();
});

const ALL_ACTION_TYPES: BrowserActionType[] = ['navigate', 'click', 'fill', 'type', 'screenshot', 'select', 'scroll'];

function randomActionType(): BrowserActionType {
  return ALL_ACTION_TYPES[Math.floor(Math.random() * ALL_ACTION_TYPES.length)]!;
}

function randomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
  let r = '';
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

describe('Automation Tracker', () => {
  it('should emit a browser action with correct fields', () => {
    const action = emitBrowserAction({
      actionType: 'click',
      description: 'Clicked submit button',
      metadata: { selector: '#submit-btn' },
    });

    expect(action.id).toBe(1);
    expect(action.actionType).toBe('click');
    expect(action.description).toBe('Clicked submit button');
    expect(action.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should assign incrementing IDs', () => {
    const a1 = emitBrowserAction({ actionType: 'navigate', description: 'Nav 1' });
    const a2 = emitBrowserAction({ actionType: 'click', description: 'Click 1' });
    expect(a2.id).toBeGreaterThan(a1.id);
  });

  // PBT: Browser action events contain required fields
  describe('Property: Browser action events contain required fields', () => {
    for (let i = 0; i < 20; i++) {
      it(`schema compliance iteration ${i + 1}`, () => {
        _resetTrackerForTesting();
        const count = 1 + Math.floor(Math.random() * 10);

        for (let j = 0; j < count; j++) {
          const actionType = randomActionType();
          const description = randomString(5 + Math.floor(Math.random() * 30));

          const action = emitBrowserAction({ actionType, description });

          expect(typeof action.id).toBe('number');
          expect(action.id).toBeGreaterThan(0);
          expect(ALL_ACTION_TYPES).toContain(action.actionType);
          expect(typeof action.description).toBe('string');
          expect(action.description.length).toBeGreaterThan(0);
          expect(new Date(action.timestamp).toISOString()).toBe(action.timestamp);
        }
      });
    }
  });
});
