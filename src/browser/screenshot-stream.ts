/**
 * Screenshot Stream
 *
 * Periodically captures browser screenshots and broadcasts them to
 * connected dashboard clients via SSE. Pauses when no clients are
 * connected to conserve resources.
 */

import { getActivePage } from './browser.js';
import { broadcast, getSSEClientCount } from '../web/events.js';
import { getScreenshotInterval } from '../config.js';
import { logger } from '../ui/logger.js';

// ── State ────────────────────────────────────────────

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _intervalMs: number = 2000;
let _streaming = false;
let _lastScreenshot: ScreenshotPayload | null = null;

interface ScreenshotPayload {
  image: string;       // base64 PNG
  url: string;
  title: string;
  timestamp: string;
}

// ── Public API ───────────────────────────────────────

/**
 * Start the periodic screenshot capture loop.
 */
export function startScreenshotStream(options?: { intervalMs?: number }): void {
  if (_streaming) return;

  _intervalMs = options?.intervalMs ?? getScreenshotInterval();
  _streaming = true;

  _intervalId = setInterval(captureAndBroadcast, _intervalMs);
  logger.info(`Screenshot stream started (${_intervalMs}ms interval)`);
}

/**
 * Stop the screenshot capture loop.
 */
export function stopScreenshotStream(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _streaming = false;
  _lastScreenshot = null;
  logger.info('Screenshot stream stopped');
}

/**
 * Change the capture interval without restarting.
 */
export function setScreenshotInterval(intervalMs: number): void {
  _intervalMs = intervalMs;

  if (_streaming && _intervalId) {
    clearInterval(_intervalId);
    _intervalId = setInterval(captureAndBroadcast, _intervalMs);
    logger.debug(`Screenshot interval updated to ${_intervalMs}ms`);
  }
}

/**
 * Check if the stream is currently active.
 */
export function isStreaming(): boolean {
  return _streaming;
}

/**
 * Get the most recent screenshot payload (for new SSE clients).
 */
export function getLastScreenshot(): ScreenshotPayload | null {
  return _lastScreenshot;
}

// ── Capture Loop ─────────────────────────────────────

async function captureAndBroadcast(): Promise<void> {
  // Client-aware pause: skip if no dashboard clients connected
  if (getSSEClientCount() === 0) {
    return;
  }

  const page = getActivePage();

  if (!page) {
    // Browser not active  - broadcast status and skip
    broadcast('browser-status', { active: false, timestamp: new Date().toISOString() });
    return;
  }

  try {
    const buffer = await page.screenshot();
    const image = buffer.toString('base64');
    const url = page.url();
    const title = await page.title().catch(() => '');
    const timestamp = new Date().toISOString();

    const payload: ScreenshotPayload = { image, url, title, timestamp };
    _lastScreenshot = payload;

    broadcast('screenshot', payload);
  } catch (err) {
    // Page may have been closed between the check and the screenshot
    logger.debug(`Screenshot capture failed: ${err}`);
    broadcast('browser-status', { active: false, timestamp: new Date().toISOString() });
  }
}
