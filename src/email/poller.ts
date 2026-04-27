import { getConfig } from '../config.js';
import { logger } from '../ui/logger.js';

/**
 * Email Poller  - polls Gmail for incoming institutional emails.
 *
 * SCAFFOLD: Gmail API integration deferred.
 * This module provides the interface and structure.
 * Wire up Gmail OAuth2 credentials when available.
 */

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}

export type EmailClassification =
  | 'deadline_change'
  | 'new_assignment'
  | 'grade_feedback'
  | 'clarification'
  | 'general_announcement';

/**
 * Start the email polling loop.
 * Polls every EMAIL_POLL_INTERVAL minutes.
 */
export function startEmailPolling(): NodeJS.Timeout | null {
  const config = getConfig();

  if (!config.GMAIL_CLIENT_ID || !config.GMAIL_CLIENT_SECRET) {
    logger.info('Gmail not configured. Email monitoring disabled.');
    return null;
  }

  const intervalMs = config.EMAIL_POLL_INTERVAL * 60 * 1000;

  logger.info(`Email polling started (every ${config.EMAIL_POLL_INTERVAL} minutes)`);

  return setInterval(async () => {
    try {
      await pollEmails();
    } catch (err) {
      logger.error(`Email poll failed: ${err}`);
    }
  }, intervalMs);
}

async function pollEmails(): Promise<void> {
  // TODO: Implement Gmail API polling
  // 1. Fetch unread emails from Gmail
  // 2. Filter by INSTITUTION_DOMAIN or INSTRUCTOR_EMAIL_LIST
  // 3. Classify each email
  // 4. Take action based on classification
  logger.debug('Email poll cycle (not implemented)');
}

/**
 * Stop the email polling loop.
 */
export function stopEmailPolling(timer: NodeJS.Timeout | null): void {
  if (timer) {
    clearInterval(timer);
    logger.info('Email polling stopped');
  }
}
