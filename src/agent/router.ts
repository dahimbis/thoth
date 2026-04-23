import { generateText } from 'ai';
import { type Page } from 'playwright';
import { getClassifierModel } from './providers.js';
import { extractPageText } from '../browser/vision.js';
import { type AssignmentType } from '../db/schema.js';
import { logger } from '../ui/logger.js';

/**
 * Assignment Type Router
 *
 * Classification rules (checked in order):
 * 1. Countdown timer or time limit visible -> quiz
 * 2. File picker / drag-drop upload zone   -> file-upload
 * 3. Redirect to third-party domain        -> external-tool
 * 4. Threaded discussion interface          -> discussion-post
 * 5. Rich text editor box only             -> inline-text
 */
export async function classifyAssignment(
  page: Page,
  metadata?: { type?: string; title?: string },
): Promise<AssignmentType> {
  // Quick classification from metadata if available
  if (metadata?.type) {
    const typeMap: Record<string, AssignmentType> = {
      dropbox: 'file-upload',
      quiz: 'quiz',
      discussion: 'discussion-post',
    };
    const mapped = typeMap[metadata.type.toLowerCase()];
    if (mapped) {
      logger.debug(`Quick classification from metadata: ${mapped}`);
      return mapped;
    }
  }

  // DOM-based classification (fast, no AI cost)
  const domClassification = await classifyFromDOM(page);
  if (domClassification) {
    logger.debug(`DOM-based classification: ${domClassification}`);
    return domClassification;
  }

  // AI-based classification (fallback)
  return classifyWithAI(page);
}

/**
 * Classify by inspecting DOM elements directly.
 * This is fast and costs nothing.
 */
async function classifyFromDOM(page: Page): Promise<AssignmentType | null> {
  return page.evaluate(() => {
    const url = window.location.href.toLowerCase();
    const body = document.body;

    // Rule 1: Quiz indicators
    if (
      url.includes('quiz') ||
      url.includes('quizzing') ||
      body.querySelector('.d2l-quiz-timer, [class*="timer"], [class*="countdown"]') ||
      body.querySelector('[class*="quiz"]')
    ) {
      return 'quiz' as const;
    }

    // Rule 2: File upload indicators
    if (
      url.includes('dropbox') ||
      url.includes('folder_submit') ||
      body.querySelector('input[type="file"]') ||
      body.querySelector('[class*="dropzone"], [class*="upload"], [class*="file-picker"]')
    ) {
      return 'file-upload' as const;
    }

    // Rule 3: External tool
    const currentDomain = window.location.hostname;
    const iframes = body.querySelectorAll('iframe[src]');
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') ?? '';
      try {
        const iframeHost = new URL(src, window.location.href).hostname;
        if (
          iframeHost !== currentDomain &&
          (iframeHost.includes('gradescope') ||
            iframeHost.includes('turnitin') ||
            iframeHost.includes('mcgraw') ||
            iframeHost.includes('pearson') ||
            iframeHost.includes('cengage') ||
            iframeHost.includes('wiley'))
        ) {
          return 'external-tool' as const;
        }
      } catch {
        // Invalid URL
      }
    }

    // Rule 4: Discussion indicators
    if (
      url.includes('discussion') ||
      url.includes('topics') ||
      body.querySelector('[class*="discussion"], [class*="thread"], [class*="forum"]')
    ) {
      return 'discussion-post' as const;
    }

    // Rule 5: Inline text editor
    if (
      body.querySelector('[contenteditable="true"]') ||
      body.querySelector('.d2l-richtext-editor') ||
      body.querySelector('iframe[class*="editor"]')
    ) {
      // But not if there's also a file upload
      if (!body.querySelector('input[type="file"]')) {
        return 'inline-text' as const;
      }
    }

    return null;
  });
}

/**
 * Classify using AI when DOM inspection is inconclusive.
 */
async function classifyWithAI(page: Page): Promise<AssignmentType> {
  const pageText = await extractPageText(page);
  const url = page.url();

  const { text } = await generateText({
    model: getClassifierModel(),
    system: `You are an LMS assignment classifier. Given page content and URL, classify the assignment into exactly one of these types:
- quiz: timed test with per-question navigation
- file-upload: submit a document, code archive, or media file
- inline-text: type directly into a text editor
- discussion-post: original post plus peer replies
- external-tool: Gradescope, Turnitin, McGraw-Hill, etc.

Respond with ONLY the type name, nothing else.`,
    prompt: `URL: ${url}\n\nPage content (first 3000 chars):\n${pageText.substring(0, 3000)}`,
    maxOutputTokens: 20,
  });

  const cleaned = text.trim().toLowerCase() as AssignmentType;

  const valid: AssignmentType[] = ['quiz', 'file-upload', 'inline-text', 'discussion-post', 'external-tool'];
  if (valid.includes(cleaned)) {
    logger.info(`AI classification: ${cleaned}`);
    return cleaned;
  }

  // Default fallback
  logger.warn(`AI returned invalid type "${text}", defaulting to file-upload`);
  return 'file-upload';
}
