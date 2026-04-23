import { type Page } from 'playwright';
import { getConfig } from '../../config.js';
import { navigateTo, takeScreenshot } from '../browser.js';
import { extractPageText, extractQuizQuestion } from '../vision.js';
import { getBrightspaceClient } from '../../api/client.js';
import { logger } from '../../ui/logger.js';

export interface QuizInfo {
  title: string;
  lmsItemId: string;
  deadline: string;
  timeLimitMinutes: number | null;
  attemptCount: number | null;
  attemptsAllowed: number | null;
  pointsValue: number | null;
  status: 'not-started' | 'in-progress' | 'submitted' | 'graded';
}

export interface QuizAttemptState {
  timeRemainingSeconds: number;
  currentQuestion: number;
  totalQuestions: number;
  answeredQuestions: number[];
  skippedQuestions: Array<{ number: number; confidence: number }>;
}

/**
 * Scan all quizzes for a course.
 */
export async function scanQuizzes(orgUnitId: string, courseName: string): Promise<QuizInfo[]> {
  logger.info('Scanning quizzes...', { course: courseName });

  try {
    return await scanQuizzesViaApi(orgUnitId, courseName);
  } catch (err) {
    logger.warn(`API quiz scan failed: ${err}. Falling back to browser.`, { course: courseName });
    return scanQuizzesViaBrowser(orgUnitId, courseName);
  }
}

async function scanQuizzesViaApi(orgUnitId: string, courseName: string): Promise<QuizInfo[]> {
  const client = getBrightspaceClient();
  const quizzes = await client.getQuizzes(orgUnitId);

  const results: QuizInfo[] = [];

  for (const quiz of quizzes) {
    const q = quiz as {
      QuizId?: number;
      Name?: string;
      DueDate?: string;
      TimeLimit?: { TimeLimit?: number; IsEnforced?: boolean };
      AttemptsAllowed?: { NumberOfAttemptsAllowed?: number };
      GradeItemId?: number;
      TotalPoints?: number;
    };

    if (!q.QuizId || !q.Name) continue;

    results.push({
      title: q.Name,
      lmsItemId: String(q.QuizId),
      deadline: q.DueDate ?? '2099-12-31T23:59:59Z',
      timeLimitMinutes: q.TimeLimit?.IsEnforced ? (q.TimeLimit.TimeLimit ?? null) : null,
      attemptCount: null,
      attemptsAllowed: q.AttemptsAllowed?.NumberOfAttemptsAllowed ?? null,
      pointsValue: q.TotalPoints ?? null,
      status: 'not-started',
    });
  }

  logger.info(`Found ${results.length} quizzes via API`, { course: courseName });
  return results;
}

async function scanQuizzesViaBrowser(orgUnitId: string, courseName: string): Promise<QuizInfo[]> {
  const config = getConfig();
  const page = await navigateTo(
    `${config.BRIGHTSPACE_BASE_URL}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${orgUnitId}`,
    { waitUntil: 'networkidle' },
  );

  await takeScreenshot(page, `quizzes-${orgUnitId}`);

  const quizzes = await page.evaluate((baseUrl: string) => {
    const results: QuizInfo[] = [];
    const rows = document.querySelectorAll('table tr, .d2l-datalist-item');

    for (const row of rows) {
      const linkEl = row.querySelector<HTMLAnchorElement>('a[href*="quiz"]');
      const title = linkEl?.textContent?.trim();
      if (!title) continue;

      const href = linkEl?.getAttribute('href') ?? '';
      const idMatch = href.match(/qi=(\d+)/);

      results.push({
        title,
        lmsItemId: idMatch?.[1] ?? '',
        deadline: '2099-12-31T23:59:59Z',
        timeLimitMinutes: null,
        attemptCount: null,
        attemptsAllowed: null,
        pointsValue: null,
        status: 'not-started' as const,
      });
    }

    return results;
  }, config.BRIGHTSPACE_BASE_URL);

  logger.info(`Found ${quizzes.length} quizzes via browser`, { course: courseName });
  return quizzes;
}

/**
 * Start a quiz attempt. Navigate to the quiz start page and click Start.
 * Returns the page ready for question answering.
 */
export async function startQuizAttempt(
  orgUnitId: string,
  quizId: string,
): Promise<{ page: Page; state: QuizAttemptState }> {
  const config = getConfig();
  const page = await navigateTo(
    `${config.BRIGHTSPACE_BASE_URL}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${quizId}&ou=${orgUnitId}`,
    { waitUntil: 'networkidle' },
  );

  await takeScreenshot(page, `quiz-start-${quizId}`);

  // Extract quiz metadata from the summary page
  const pageText = await extractPageText(page);

  // Parse time limit from page text
  let timeLimitSeconds = 0;
  const timeMatch = pageText.match(/(\d+)\s*(?:minute|min)/i);
  if (timeMatch) {
    timeLimitSeconds = parseInt(timeMatch[1]!, 10) * 60;
  }

  // Parse question count
  let totalQuestions = 0;
  const qCountMatch = pageText.match(/(\d+)\s*(?:question|item)/i);
  if (qCountMatch) {
    totalQuestions = parseInt(qCountMatch[1]!, 10);
  }

  // Click "Start Quiz" button
  const startSelectors = [
    'button:has-text("Start Quiz")',
    'button:has-text("Start")',
    'a:has-text("Start Quiz")',
    'input[value*="Start"]',
    '.d2l-button-primary',
  ];

  for (const selector of startSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await page.waitForLoadState('networkidle');
        break;
      }
    } catch {
      // Try next
    }
  }

  await takeScreenshot(page, `quiz-started-${quizId}`);

  const state: QuizAttemptState = {
    timeRemainingSeconds: timeLimitSeconds,
    currentQuestion: 1,
    totalQuestions,
    answeredQuestions: [],
    skippedQuestions: [],
  };

  return { page, state };
}

/**
 * Navigate to a specific question in the quiz.
 */
export async function navigateToQuestion(page: Page, questionNumber: number): Promise<void> {
  // Try clicking on question number in the quiz navigation
  try {
    const navItem = page.locator(`a:has-text("${questionNumber}"), button:has-text("Question ${questionNumber}")`).first();
    if (await navItem.isVisible({ timeout: 2000 })) {
      await navItem.click();
      await page.waitForLoadState('domcontentloaded');
      return;
    }
  } catch {
    // Not available
  }

  // Fallback: use Next/Previous buttons
  logger.debug(`Direct navigation to Q${questionNumber} not available, using sequential navigation`);
}

/**
 * Select an answer for a multiple choice question.
 */
export async function selectMCQAnswer(page: Page, answerIndex: number): Promise<boolean> {
  try {
    // Brightspace MCQ options are typically radio buttons
    const radioButtons = page.locator('input[type="radio"]');
    const count = await radioButtons.count();

    if (answerIndex >= count) {
      logger.warn(`Answer index ${answerIndex} out of range (${count} options)`);
      return false;
    }

    await radioButtons.nth(answerIndex).click();
    return true;
  } catch (err) {
    logger.error(`Failed to select MCQ answer: ${err}`);
    return false;
  }
}

/**
 * Type an answer for a short-answer or essay question.
 */
export async function typeAnswer(page: Page, answer: string): Promise<boolean> {
  try {
    // Look for text input or textarea
    const textInput = page.locator('textarea, input[type="text"], .d2l-richtext-editor, [contenteditable="true"]').first();
    if (await textInput.isVisible({ timeout: 2000 })) {
      await textInput.fill(answer);
      return true;
    }

    // Try iframe-based rich text editor
    const iframe = page.frameLocator('iframe[class*="editor"], iframe[id*="editor"]').first();
    const body = iframe.locator('body');
    await body.fill(answer);
    return true;
  } catch (err) {
    logger.error(`Failed to type answer: ${err}`);
    return false;
  }
}

/**
 * Click the "Next" button to move to the next question.
 */
export async function clickNextQuestion(page: Page): Promise<boolean> {
  const nextSelectors = [
    'button:has-text("Next")',
    'a:has-text("Next")',
    'input[value*="Next"]',
    '.d2l-quiz-next',
    '[aria-label*="Next"]',
  ];

  for (const selector of nextSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await page.waitForLoadState('domcontentloaded');
        return true;
      }
    } catch {
      // Try next
    }
  }

  logger.warn('Could not find Next button');
  return false;
}

/**
 * Submit the quiz.
 */
export async function submitQuiz(page: Page): Promise<{
  success: boolean;
  receiptText: string;
  screenshotPath: string;
}> {
  // Navigate to submission/review page
  const submitSelectors = [
    'button:has-text("Submit Quiz")',
    'button:has-text("Submit")',
    'a:has-text("Submit Quiz")',
    'input[value*="Submit"]',
  ];

  for (const selector of submitSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        break;
      }
    } catch {
      // Try next
    }
  }

  await page.waitForLoadState('networkidle');

  // Handle confirmation dialog
  try {
    const confirmBtn = page.locator('button:has-text("Submit"), button:has-text("Yes")').first();
    if (await confirmBtn.isVisible({ timeout: 3000 })) {
      await confirmBtn.click();
      await page.waitForLoadState('networkidle');
    }
  } catch {
    // No confirmation
  }

  const screenshotPath = await takeScreenshot(page, 'quiz-submission-receipt');
  const receiptText = await extractPageText(page);

  const success =
    receiptText.toLowerCase().includes('submitted') ||
    receiptText.toLowerCase().includes('complete') ||
    receiptText.toLowerCase().includes('received');

  return { success, receiptText, screenshotPath };
}

/**
 * Read the remaining time from the quiz timer element on the page.
 */
export async function readQuizTimer(page: Page): Promise<number | null> {
  try {
    const timerText = await page.evaluate(() => {
      const timerEl =
        document.querySelector('.d2l-quiz-timer, [class*="timer"], [class*="countdown"], #quizTimer') ??
        document.querySelector('[aria-label*="time"], [aria-label*="remaining"]');
      return timerEl?.textContent?.trim() ?? null;
    });

    if (!timerText) return null;

    // Parse "HH:MM:SS" or "MM:SS" or "X minutes"
    const hmsMatch = timerText.match(/(\d+):(\d+):(\d+)/);
    if (hmsMatch) {
      return parseInt(hmsMatch[1]!, 10) * 3600 + parseInt(hmsMatch[2]!, 10) * 60 + parseInt(hmsMatch[3]!, 10);
    }

    const msMatch = timerText.match(/(\d+):(\d+)/);
    if (msMatch) {
      return parseInt(msMatch[1]!, 10) * 60 + parseInt(msMatch[2]!, 10);
    }

    const minMatch = timerText.match(/(\d+)\s*min/i);
    if (minMatch) {
      return parseInt(minMatch[1]!, 10) * 60;
    }

    return null;
  } catch {
    return null;
  }
}
