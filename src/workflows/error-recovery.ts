import { type Page } from 'playwright';
import { reAuthenticate } from '../browser/auth.js';
import { isLoginPage, takeScreenshot, navigateTo } from '../browser/browser.js';
import { diagnosePageState } from '../browser/vision.js';
import { logAction } from '../db/queries.js';
import { logger } from '../ui/logger.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10_000;

/**
 * Retry a page load with exponential backoff.
 */
export async function retryNavigation(
  url: string,
  retries: number = MAX_RETRIES,
): Promise<Page | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.debug(`Navigation attempt ${attempt}/${retries}: ${url}`);
      const page = await navigateTo(url, { waitUntil: 'domcontentloaded' });

      // Check for session expiry
      if (await isLoginPage(page)) {
        logger.warn('Session expired during navigation. Re-authenticating...');
        logAction(null, 'session_expired', `During navigation to ${url}`);
        await reAuthenticate();
        // Retry the navigation after re-auth
        return navigateTo(url, { waitUntil: 'domcontentloaded' });
      }

      return page;
    } catch (err) {
      logger.error(`Navigation attempt ${attempt} failed: ${err}`);

      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * attempt;
        logger.info(`Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  logger.error(`Navigation failed after ${retries} attempts: ${url}`);
  logAction(null, 'navigation_failed', `${url} after ${retries} attempts`);
  return null;
}

/**
 * Handle an unknown page state.
 * Takes a screenshot, sends to AI for diagnosis, and returns guidance.
 */
export async function handleUnknownState(page: Page): Promise<{
  action: string;
  isRecoverable: boolean;
}> {
  const screenshotPath = await takeScreenshot(page, 'unknown-state');
  logAction(null, 'unknown_state', `URL: ${page.url()}`, screenshotPath);

  const diagnosis = await diagnosePageState(page);

  if (diagnosis.isLoginPage) {
    logger.warn('Unknown state diagnosed as login page. Re-authenticating...');
    await reAuthenticate();
    return { action: 'Re-authenticated. Resume task.', isRecoverable: true };
  }

  if (diagnosis.isErrorPage) {
    logger.error(`Error page detected: ${diagnosis.description}`);
    return { action: 'Error page. Skip and alert user.', isRecoverable: false };
  }

  logger.info(`Page diagnosis: ${diagnosis.description}`);
  logger.info(`Suggested action: ${diagnosis.suggestedAction}`);

  return {
    action: diagnosis.suggestedAction,
    isRecoverable: true,
  };
}

/**
 * Wrap an async operation with session-expiry detection and retry.
 */
export async function withSessionRecovery<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    const errorMsg = String(err);

    // Check if this is an auth error
    if (
      errorMsg.includes('401') ||
      errorMsg.includes('403') ||
      errorMsg.includes('session') ||
      errorMsg.includes('login') ||
      errorMsg.includes('Auth error')
    ) {
      logger.warn(`Session expired during ${operationName}. Re-authenticating...`);
      await reAuthenticate();

      // Retry the operation once
      logger.info(`Retrying ${operationName} after re-authentication`);
      return operation();
    }

    throw err;
  }
}

/**
 * Wrap an upload operation with retry logic.
 */
export async function withUploadRetry<T>(
  uploadFn: () => Promise<T>,
  failoverSavePath: string,
): Promise<T> {
  try {
    return await uploadFn();
  } catch (firstErr) {
    logger.warn(`Upload failed: ${firstErr}. Retrying in 30s...`);
    await new Promise((r) => setTimeout(r, 30_000));

    try {
      return await uploadFn();
    } catch (secondErr) {
      logger.error(`Upload failed again: ${secondErr}. File saved at: ${failoverSavePath}`);
      logAction(null, 'upload_failed', `File saved at ${failoverSavePath}. Error: ${secondErr}`);
      throw new Error(`Upload failed. File saved at: ${failoverSavePath}. Error: ${secondErr}`);
    }
  }
}

/**
 * Check for stale tasks (in-progress for > 2 hours).
 */
export function checkForStaleTasks(assignments: Array<{ id: number; status: string; updatedAt: string | null; title: string; course: string }>): void {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  for (const a of assignments) {
    if (a.status === 'in-progress' && a.updatedAt && a.updatedAt < twoHoursAgo) {
      logger.error(
        `STALE TASK: "${a.title}" (${a.course}) has been in-progress for over 2 hours`,
        { course: a.course, task: a.title, status: 'STALE' },
      );
      logAction(a.id, 'stale_task_detected', `In-progress since ${a.updatedAt}`);
    }
  }
}
