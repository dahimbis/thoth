/**
 * Automation Tracker
 *
 * Captures and broadcasts browser interaction events (clicks, navigation,
 * typing, form fills) to the dashboard in real time via SSE.
 */

import { type Page } from 'playwright';
import { broadcast } from '../web/events.js';

// ── Types ────────────────────────────────────────────

export type BrowserActionType = 'navigate' | 'click' | 'fill' | 'type' | 'screenshot' | 'select' | 'scroll';

export interface BrowserAction {
  id: number;
  timestamp: string;
  actionType: BrowserActionType;
  description: string;
  metadata?: {
    url?: string;
    selector?: string;
    valueLength?: number;
    screenshotName?: string;
    reason?: string;
  };
}

// ── State ────────────────────────────────────────────

let actionIdCounter = 0;

// ── Public API ───────────────────────────────────────

/**
 * Emit a browser action event and broadcast it to SSE clients.
 */
export function emitBrowserAction(
  action: Omit<BrowserAction, 'id' | 'timestamp'>,
): BrowserAction {
  const full: BrowserAction = {
    ...action,
    id: ++actionIdCounter,
    timestamp: new Date().toISOString(),
  };

  broadcast('browser-action', full);
  return full;
}

/**
 * Hook into a Playwright page to automatically track navigation events.
 */
export function trackPage(page: Page): void {
  page.on('framenavigated', (frame) => {
    // Only track main frame navigations
    if (frame === page.mainFrame()) {
      emitBrowserAction({
        actionType: 'navigate',
        description: `Navigated to: ${frame.url()}`,
        metadata: { url: frame.url() },
      });
    }
  });
}

/**
 * Reset internal state. Only for testing.
 */
export function _resetTrackerForTesting(): void {
  actionIdCounter = 0;
}
