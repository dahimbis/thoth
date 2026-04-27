/**
 * Notification System
 *
 * Centralized notification management for form detections, data extractions,
 * quiz readiness, and other events that need user attention.
 * Broadcasts notifications to connected SSE clients and supports desktop
 * browser notifications via the Notification API.
 */

import { broadcast } from './events.js';

// ── Types ────────────────────────────────────────────

export type NotificationType = 'info' | 'warning' | 'action-required' | 'urgent';

export type NotificationCategory =
  | 'form-detected'
  | 'data-extracted'
  | 'external-tool'
  | 'quiz-ready'
  | 'email-alert'
  | 'session-expired';

export interface AppNotification {
  id: number;
  timestamp: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  dismissed: boolean;
  metadata?: Record<string, string | number>;
}

// ── State ────────────────────────────────────────────

let notificationIdCounter = 0;
const notifications: AppNotification[] = [];

// ── Public API ───────────────────────────────────────

/**
 * Emit a notification. Assigns an ID, stores it, and broadcasts to SSE clients.
 */
export function emitNotification(
  notification: Omit<AppNotification, 'id' | 'timestamp' | 'dismissed'>,
): AppNotification {
  const full: AppNotification = {
    ...notification,
    id: ++notificationIdCounter,
    timestamp: new Date().toISOString(),
    dismissed: false,
  };

  notifications.push(full);
  broadcast('notification', full);

  return full;
}

/**
 * Get notifications, optionally filtering to undismissed only.
 */
export function getNotifications(options?: { undismissedOnly?: boolean }): AppNotification[] {
  if (options?.undismissedOnly) {
    return notifications.filter((n) => !n.dismissed);
  }
  return [...notifications];
}

/**
 * Dismiss a notification by ID.
 */
export function dismissNotification(id: number): boolean {
  const notification = notifications.find((n) => n.id === id);
  if (!notification) return false;
  notification.dismissed = true;
  return true;
}

/**
 * Get the count of undismissed notifications.
 */
export function getUnreadCount(): number {
  return notifications.filter((n) => !n.dismissed).length;
}

/**
 * Reset internal state. Only for testing.
 */
export function _resetNotificationsForTesting(): void {
  notificationIdCounter = 0;
  notifications.length = 0;
}
