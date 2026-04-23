import { type Page } from 'playwright';
import { generateText } from 'ai';
import { getQuickModel, getWritingModel } from '../agent/providers.js';
import { screenshotToBase64 } from './browser.js';
import { logger } from '../ui/logger.js';

/**
 * Vision module — converts page screenshots into structured data using AI.
 *
 * Since we use browser accessibility snapshots (Playwright's built-in a11y tree)
 * as the primary method, this vision module is the FALLBACK for cases where:
 * - The page content is mostly visual (images, charts, graphs)
 * - Accessibility tree doesn't capture dynamic/canvas content
 * - We need to verify visual state after an action
 *
 * Primary approach: Use Playwright's page content extraction methods.
 * Fallback: Screenshot + AI vision model.
 */

// ── Page Content Extraction (Primary — no AI cost) ───

/**
 * Extract structured text content from a page using DOM queries.
 * This is faster and cheaper than vision AI.
 */
export async function extractPageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Get the main content area, falling back to body
    const main =
      document.querySelector('main') ??
      document.querySelector('[role="main"]') ??
      document.querySelector('.d2l-page-main') ??
      document.body;

    // Remove script/style/nav elements from our extraction
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, nav, header, footer, [aria-hidden="true"]')
      .forEach((el) => el.remove());

    return clone.innerText.trim();
  });
}

/**
 * Extract structured data from the current page using CSS selectors.
 * Returns key-value pairs found on the page.
 */
export async function extractStructuredData(
  page: Page,
  selectors: Record<string, string>,
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};

  for (const [key, selector] of Object.entries(selectors)) {
    try {
      const el = page.locator(selector).first();
      result[key] = await el.isVisible()
        ? await el.textContent()
        : null;
    } catch {
      result[key] = null;
    }
  }

  return result;
}

// ── AI Vision Analysis (Fallback) ────────────────────

/**
 * Describe what's on the current page using AI vision.
 * Used when DOM extraction is insufficient.
 */
export async function describePageVisually(page: Page, prompt?: string): Promise<string> {
  const base64 = await screenshotToBase64(page);

  const { text } = await generateText({
    model: getQuickModel(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            image: base64,
            mediaType: 'image/png',
          },
          {
            type: 'text',
            text: prompt ?? 'Describe exactly what is on this page. What interactive elements are visible? What text content is present?',
          },
        ],
      },
    ],
    maxOutputTokens: 2000,
  });

  return text;
}

/**
 * Extract assignment details from a page screenshot.
 * Returns structured JSON with instructions, rubric, deadlines, etc.
 */
export async function extractAssignmentDetails(page: Page): Promise<{
  title: string;
  instructions: string;
  rubric: string | null;
  deadline: string | null;
  fileFormat: string | null;
  wordLimit: string | null;
  citationStyle: string | null;
  pointsValue: number | null;
}> {
  // First, try DOM extraction
  const pageText = await extractPageText(page);

  const { text } = await generateText({
    model: getQuickModel(),
    system: `You are an assignment detail extractor. Given the text content of an LMS assignment page, extract the following into JSON:
- title: assignment title
- instructions: full assignment instructions/description
- rubric: rubric criteria and point values if visible (as formatted text)
- deadline: due date/time in ISO 8601 format if visible
- fileFormat: required file format (PDF, DOCX, ZIP, etc.) if specified
- wordLimit: word or page limit if specified
- citationStyle: citation format (APA, MLA, Chicago, etc.) if specified
- pointsValue: total points if visible (as number)

Return ONLY valid JSON, no markdown fences.`,
    prompt: pageText.substring(0, 8000), // Limit to prevent token overflow
    maxOutputTokens: 2000,
  });

  try {
    return JSON.parse(text);
  } catch {
    // If AI didn't return valid JSON, return with what we have
    return {
      title: '',
      instructions: pageText.substring(0, 2000),
      rubric: null,
      deadline: null,
      fileFormat: null,
      wordLimit: null,
      citationStyle: null,
      pointsValue: null,
    };
  }
}

/**
 * Determine what action the agent should take on an unknown page.
 * Used by the error recovery system.
 */
export async function diagnosePageState(page: Page): Promise<{
  description: string;
  suggestedAction: string;
  isLoginPage: boolean;
  isErrorPage: boolean;
}> {
  const url = page.url();
  const pageText = await extractPageText(page);
  const snippet = pageText.substring(0, 3000);

  const { text } = await generateText({
    model: getQuickModel(),
    system: `You are a page state analyzer for an LMS automation agent. Given a page URL and text content, determine:
1. description: What is on this page (1-2 sentences)
2. suggestedAction: What should the agent do next
3. isLoginPage: Is this a login/authentication page?
4. isErrorPage: Is this an error page (404, 500, etc.)?

Return ONLY valid JSON, no markdown fences.`,
    prompt: `URL: ${url}\n\nPage content:\n${snippet}`,
    maxOutputTokens: 500,
  });

  try {
    return JSON.parse(text);
  } catch {
    return {
      description: 'Unknown page state',
      suggestedAction: 'Take screenshot and alert user',
      isLoginPage: url.includes('login'),
      isErrorPage: false,
    };
  }
}

/**
 * Extract quiz question details from page content.
 */
export async function extractQuizQuestion(page: Page): Promise<{
  questionText: string;
  questionType: 'mcq' | 'true-false' | 'short-answer' | 'matching' | 'essay' | 'image-based';
  options: string[];
  questionNumber: number | null;
  totalQuestions: number | null;
}> {
  const pageText = await extractPageText(page);

  const { text } = await generateText({
    model: getQuickModel(),
    system: `You are a quiz question extractor. Given page content from an LMS quiz, extract:
- questionText: the full question text
- questionType: one of: mcq, true-false, short-answer, matching, essay, image-based
- options: array of answer options (empty array if short-answer/essay)
- questionNumber: current question number if visible
- totalQuestions: total number of questions if visible

Return ONLY valid JSON, no markdown fences.`,
    prompt: pageText.substring(0, 5000),
    maxOutputTokens: 1500,
  });

  try {
    return JSON.parse(text);
  } catch {
    return {
      questionText: pageText.substring(0, 500),
      questionType: 'short-answer',
      options: [],
      questionNumber: null,
      totalQuestions: null,
    };
  }
}
