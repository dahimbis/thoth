import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  emitNotification,
  getNotifications,
  dismissNotification,
  getUnreadCount,
  _resetNotificationsForTesting,
} from '../src/web/notifications.js';

vi.mock('../src/web/events.js', () => ({
  broadcast: vi.fn(),
}));

beforeEach(() => {
  _resetNotificationsForTesting();
});

describe('Notification System', () => {
  it('should emit a notification with correct fields', () => {
    const n = emitNotification({
      type: 'info',
      category: 'form-detected',
      title: 'Google Form Found',
      message: 'A Google Form was detected in CS-101',
    });

    expect(n.id).toBe(1);
    expect(n.type).toBe('info');
    expect(n.category).toBe('form-detected');
    expect(n.dismissed).toBe(false);
    expect(n.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should store notifications', () => {
    emitNotification({ type: 'info', category: 'data-extracted', title: 'T1', message: 'M1' });
    emitNotification({ type: 'warning', category: 'external-tool', title: 'T2', message: 'M2' });

    expect(getNotifications()).toHaveLength(2);
  });

  it('should dismiss a notification', () => {
    const n = emitNotification({ type: 'info', category: 'form-detected', title: 'T', message: 'M' });
    expect(dismissNotification(n.id)).toBe(true);
    expect(getNotifications({ undismissedOnly: true })).toHaveLength(0);
  });

  it('should count unread notifications', () => {
    emitNotification({ type: 'info', category: 'form-detected', title: 'T1', message: 'M1' });
    emitNotification({ type: 'urgent', category: 'quiz-ready', title: 'T2', message: 'M2' });
    expect(getUnreadCount()).toBe(2);

    dismissNotification(1);
    expect(getUnreadCount()).toBe(1);
  });

  // PBT: Notification IDs are unique and monotonically increasing
  describe('Property: Notification IDs are unique and monotonically increasing', () => {
    for (let i = 0; i < 20; i++) {
      it(`monotonic IDs iteration ${i + 1}`, () => {
        _resetNotificationsForTesting();
        const count = 2 + Math.floor(Math.random() * 20);
        const ids: number[] = [];

        for (let j = 0; j < count; j++) {
          const n = emitNotification({
            type: 'info',
            category: 'data-extracted',
            title: `Notification ${j}`,
            message: `Message ${j}`,
          });
          ids.push(n.id);
        }

        // All IDs are unique
        expect(new Set(ids).size).toBe(ids.length);

        // All IDs are monotonically increasing
        for (let j = 1; j < ids.length; j++) {
          expect(ids[j]).toBeGreaterThan(ids[j - 1]!);
        }
      });
    }
  });
});
