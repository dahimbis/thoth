import { type Page } from 'playwright';
import { generateText } from 'ai';
import { navigateTo, takeScreenshot } from '../browser.js';
import { extractPageText } from '../vision.js';
import { getQuickModel } from '../../agent/providers.js';
import { getStudentProfile, type StudentProfile } from '../../config.js';
import { logger } from '../../ui/logger.js';
import { logAction } from '../../db/queries.js';
import { emitNotification } from '../../web/notifications.js';

/**
 * Google Forms Automation Module
 *
 * Handles filling out Google Forms found in emails or assignment pages.
 * Uses student profile data to auto-fill known fields (name, email, ID, etc.)
 * and AI to answer form-specific questions.
 *
 * Flow:
 * 1. Navigate to the Google Form URL
 * 2. Extract all form fields and their types
 * 3. Auto-fill profile fields (name, email, ID, phone, etc.)
 * 4. Use AI to answer any remaining questions
 * 5. Present preview to user for confirmation
 * 6. Submit on approval
 */

// ── Types ────────────────────────────────────────────

export interface FormField {
  index: number;
  label: string;
  type: 'short-text' | 'long-text' | 'radio' | 'checkbox' | 'dropdown' | 'date' | 'time' | 'file-upload' | 'linear-scale' | 'grid' | 'unknown';
  required: boolean;
  options: string[];       // For radio/checkbox/dropdown
  currentValue: string;    // Pre-filled or already-answered value
  autoFilled: boolean;     // Whether we auto-filled from profile
  aiGenerated: boolean;    // Whether AI generated the answer
  proposedValue: string;   // What we plan to fill in
}

export interface FormAnalysis {
  title: string;
  description: string;
  fields: FormField[];
  totalFields: number;
  autoFilledCount: number;
  aiFilledCount: number;
  manualCount: number;
  hasNextPage?: boolean;
}

// ── Profile Field Matching ───────────────────────────

/**
 * Known field patterns mapped to profile data.
 * When a form label matches one of these patterns, we auto-fill
 * from the student profile instead of using AI.
 */
const PROFILE_FIELD_MATCHERS: Array<{
  patterns: RegExp[];
  profileKey: keyof StudentProfile;
}> = [
  // IMPORTANT: More specific patterns must come BEFORE generic ones
  {
    patterns: [
      /\bfirst\s*name\b/i,
      /\bgiven\s*name\b/i,
    ],
    profileKey: 'firstName',
  },
  {
    patterns: [
      /\blast\s*name\b/i,
      /\bfamily\s*name\b/i,
      /\bsurname\b/i,
    ],
    profileKey: 'lastName',
  },
  {
    patterns: [
      /\b(second\s*name|middle\s*name)\b/i,
    ],
    profileKey: 'lastName',  // Use lastName for "second name" too
  },
  {
    // Generic "name" only matches if it's literally just "name" or "full name" or "your name"
    patterns: [
      /\bfull\s*name\b/i,
      /\byour\s*name\b/i,
      /^name\s*\??$/i,
      /^what\s*is\s*your\s*name\b/i,
    ],
    profileKey: 'fullName',
  },
  {
    patterns: [
      /\b(email|e-mail|email\s*address)\b/i,
      /^email\s*\??$/i,
    ],
    profileKey: 'email',
  },
  {
    patterns: [
      /\b(student\s*id|net\s*id|n-?number|university\s*id|id\s*number)\b/i,
    ],
    profileKey: 'studentId',
  },
  {
    patterns: [
      /\b(phone|phone\s*number|contact\s*number|mobile|cell)\b/i,
    ],
    profileKey: 'phone',
  },
  {
    patterns: [
      /\b(major|field\s*of\s*study|department|program)\b/i,
    ],
    profileKey: 'major',
  },
  {
    patterns: [
      /\b(year|class\s*year|grade\s*level|academic\s*year)\b/i,
      /\b(freshman|sophomore|junior|senior|graduate)\b/i,
    ],
    profileKey: 'year',
  },
];

/**
 * Try to match a form field label to a student profile field.
 * Returns the profile value if matched, null otherwise.
 */
function matchProfileField(label: string, profile: StudentProfile): string | null {
  for (const matcher of PROFILE_FIELD_MATCHERS) {
    for (const pattern of matcher.patterns) {
      if (pattern.test(label)) {
        const value = profile[matcher.profileKey];
        if (value && value.trim().length > 0) {
          return value;
        }
      }
    }
  }
  return null;
}

// ── Form Extraction ──────────────────────────────────

/**
 * Extract fields from a Google Form page.
 * Always uses getPage() to get the current browser tab - never navigates if the form is already open.
 */
export async function extractGoogleForm(url: string, options?: { skipNavigation?: boolean }): Promise<FormAnalysis> {
  logger.info(`Extracting Google Form: ${url}`);

  const { getPage: getBrowserPage } = await import('../browser.js');
  let page;

  if (options?.skipNavigation) {
    // Just get the current page - don't navigate anywhere
    page = await getBrowserPage();
    logger.info('Using current page (skipNavigation)');
  } else {
    // First time - navigate to the form URL
    page = await navigateTo(url, { waitUntil: 'networkidle' });
  }

  // Wait for the form to fully render
  await page.waitForTimeout(2000);
  await takeScreenshot(page, 'google-form');

  // Extract form metadata
  const formData = await page.evaluate(() => {
    const titleEl = document.querySelector('[class*="freebirdFormviewerViewHeaderTitle"], .F9yp7e, [data-params]');
    const descEl = document.querySelector('[class*="freebirdFormviewerViewHeaderDescription"], .m7Aem');

    return {
      title: titleEl?.textContent?.trim() ?? 'Untitled Form',
      description: descEl?.textContent?.trim() ?? '',
    };
  });

  // Extract fields from the CURRENT page only (one page at a time)
  const rawFields = await extractFormFields(page);

  // Check if this is a multi-page form (has "Next" button)
  const hasNextPage = await page.locator('[role="button"]:has-text("Next"), span:has-text("Next")').first().isVisible({ timeout: 1000 }).catch(() => false);

  // Match profile fields and generate AI answers
  const profile = getStudentProfile();
  const fields = await processFields(rawFields, profile, page);

  const autoFilledCount = fields.filter((f) => f.autoFilled).length;
  const aiFilledCount = fields.filter((f) => f.aiGenerated).length;
  const manualCount = fields.filter((f) => !f.autoFilled && !f.aiGenerated && f.required).length;

  logger.info(
    `Form "${formData.title}": ${fields.length} fields  - ${autoFilledCount} auto-filled, ${aiFilledCount} AI-filled, ${manualCount} need manual input`,
  );

  return {
    ...formData,
    fields,
    totalFields: fields.length,
    autoFilledCount,
    aiFilledCount,
    manualCount,
    hasNextPage: hasNextPage,
  };
}

/**
 * Extract raw form fields from the Google Forms page DOM.
 */
async function extractFormFields(page: Page): Promise<Array<{
  index: number;
  label: string;
  type: string;
  required: boolean;
  options: string[];
}>> {
  return page.evaluate(() => {
    const fields: Array<{
      index: number;
      label: string;
      type: string;
      required: boolean;
      options: string[];
    }> = [];

    // Google Forms uses specific class patterns for question containers
    const questionContainers = document.querySelectorAll(
      '[class*="freebirdFormviewerComponentsQuestionBase"], .Qr7Oae, [data-params], .geS5n',
    );

    // Fallback: look for general question blocks
    const containers = questionContainers.length > 0
      ? questionContainers
      : document.querySelectorAll('[role="listitem"], .M7eMe');

    let index = 0;
    const seenLabels = new Set<string>();

    for (const container of containers) {
      // Extract label
      const labelEl = container.querySelector(
        '[class*="exportItemTitle"], .M7eMe, [data-initial-value], span[class*="M7eMe"]',
      );
      const label = labelEl?.textContent?.trim() ?? '';
      if (!label || label.length < 2) continue;

      // Skip duplicate labels (same question matched by multiple selectors)
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);

      // Skip section headers (containers with no input/textarea/radio/checkbox)
      const hasInput = container.querySelector('input, textarea, [role="radio"], [role="checkbox"], [role="listbox"], select');
      if (!hasInput) continue;

      // Check if required
      const required =
        container.querySelector('[aria-label*="Required"]') !== null ||
        container.querySelector('.vnumgf') !== null ||
        container.textContent?.includes('*') === true;

      // Determine field type
      let type = 'unknown';
      const options: string[] = [];

      // Short text input
      if (container.querySelector('input[type="text"], input:not([type])')) {
        type = 'short-text';
      }
      // Long text (textarea)
      else if (container.querySelector('textarea')) {
        type = 'long-text';
      }
      // Radio buttons
      else if (container.querySelectorAll('[role="radio"], input[type="radio"]').length > 0) {
        type = 'radio';
        const radioLabels = container.querySelectorAll('[data-value], .docssharedWizToggleLabeledContent, .nWQGrd');
        radioLabels.forEach((r) => {
          const text = r.textContent?.trim();
          if (text) options.push(text);
        });
      }
      // Checkboxes
      else if (container.querySelectorAll('[role="checkbox"], input[type="checkbox"]').length > 0) {
        type = 'checkbox';
        const checkLabels = container.querySelectorAll('[data-value], .docssharedWizToggleLabeledContent, .nWQGrd');
        checkLabels.forEach((c) => {
          const text = c.textContent?.trim();
          if (text) options.push(text);
        });
      }
      // Dropdown
      else if (container.querySelector('[role="listbox"], select')) {
        type = 'dropdown';
        const optionEls = container.querySelectorAll('[role="option"], option');
        optionEls.forEach((o) => {
          const text = o.textContent?.trim();
          if (text && text !== 'Choose') options.push(text);
        });
      }
      // Date
      else if (container.querySelector('input[type="date"], [data-type="9"]')) {
        type = 'date';
      }
      // Time
      else if (container.querySelector('input[type="time"], [data-type="10"]')) {
        type = 'time';
      }
      // Linear scale
      else if (container.querySelectorAll('[role="radio"]').length > 3) {
        type = 'linear-scale';
        const scaleLabels = container.querySelectorAll('[data-value]');
        scaleLabels.forEach((s) => {
          const text = s.textContent?.trim();
          if (text) options.push(text);
        });
      }

      fields.push({ index: index++, label, type, required, options });
    }

    return fields;
  });
}

/**
 * Process raw fields: match to profile, generate AI answers for the rest.
 */
async function processFields(
  rawFields: Array<{ index: number; label: string; type: string; required: boolean; options: string[] }>,
  profile: StudentProfile,
  page: Page,
): Promise<FormField[]> {
  const fields: FormField[] = [];

  // Collect fields that need AI answers
  const aiFields: Array<{ index: number; label: string; type: string; options: string[] }> = [];

  for (const raw of rawFields) {
    const profileValue = matchProfileField(raw.label, profile);

    if (profileValue) {
      // Auto-fill from profile
      fields.push({
        ...raw,
        type: raw.type as FormField['type'],
        currentValue: '',
        autoFilled: true,
        aiGenerated: false,
        proposedValue: profileValue,
      });
    } else {
      aiFields.push(raw);
      fields.push({
        ...raw,
        type: raw.type as FormField['type'],
        currentValue: '',
        autoFilled: false,
        aiGenerated: false,
        proposedValue: '',
      });
    }
  }

  // Generate AI answers for remaining fields in batch
  if (aiFields.length > 0) {
    const aiAnswers = await generateFormAnswers(aiFields, profile, page);

    for (const [i, answer] of aiAnswers.entries()) {
      const fieldIndex = aiFields[i]?.index;
      if (fieldIndex === undefined) continue;
      const field = fields.find((f) => f.index === fieldIndex);
      if (field) {
        field.proposedValue = answer;
        field.aiGenerated = true;
      }
    }
  }

  return fields;
}

/**
 * Use AI to generate appropriate answers for form fields.
 */
async function generateFormAnswers(
  fields: Array<{ index: number; label: string; type: string; options: string[] }>,
  profile: StudentProfile,
  page: Page,
): Promise<string[]> {
  const pageTitle = await page.title();
  const pageText = await extractPageText(page);
  const contextSnippet = pageText.substring(0, 2000);

  const fieldDescriptions = fields.map((f) => {
    let desc = `Field ${f.index + 1}: "${f.label}" (type: ${f.type})`;
    if (f.options.length > 0) {
      desc += `\n  Options: ${f.options.join(', ')}`;
    }
    return desc;
  }).join('\n\n');

  let text: string;
  try {
    const result = await generateText({
      model: getQuickModel(),
      system: `You are filling out a Google Form for a university student. The student's profile:
- Name: ${profile.fullName}
- Email: ${profile.email}
- Student ID: ${profile.studentId}
- Major: ${profile.major || 'Not specified'}
- Year: ${profile.year || 'Not specified'}
- Institution: ${profile.institution}

For each form field, provide an appropriate answer. Rules:
1. For radio/checkbox/dropdown: select from the available options ONLY. Return the exact option text.
2. For short-text: keep answers brief and factual.
3. For long-text: write a thoughtful response (2-4 sentences).
4. For date: use YYYY-MM-DD format.
5. For unknown fields: make your best judgment.

Return answers as a JSON array of strings, one per field, in order.
Return ONLY the JSON array, no markdown fences.`,
      prompt: `Form title: ${pageTitle}

Form context:
${contextSnippet}

Fields to answer:
${fieldDescriptions}`,
      maxOutputTokens: 2000,
    });
    text = result.text;
  } catch (aiErr: any) {
    logger.error(`AI call failed: ${aiErr.message}`);
    logger.warn('AI unavailable - using smart defaults for unknown fields.');
    // Smart defaults without AI
    return fields.map((f) => {
      if (f.options.length > 0) {
        // Prefer "Yes" if it's an option, otherwise pick the first option
        const yesOption = f.options.find(o => /^yes$/i.test(o.trim()));
        return yesOption ?? f.options[0] ?? '';
      }
      // For text fields, provide a generic answer
      if (f.type === 'short-text' || f.type === 'long-text') {
        return 'N/A';
      }
      return '';
    });
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  } catch {
    // Try line-by-line fallback
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length >= fields.length) {
      return lines.slice(0, fields.length);
    }
  }

  // Default to empty strings
  return fields.map(() => '');
}

// ── Form Filling ─────────────────────────────────────

/**
 * Fill a Google Form with the proposed values.
 * Uses label-based field matching for reliability.
 */
export async function fillGoogleForm(
  url: string,
  fields: FormField[],
): Promise<{ success: boolean; screenshotPath: string }> {
  const { getPage: getBrowserPage } = await import('../browser.js');
  const page = await getBrowserPage();
  await page.waitForTimeout(1000);

  logger.info(`[FILL] Starting to fill ${fields.length} fields on: ${page.url()}`);

  // Scroll to bottom and back to ensure all elements are rendered
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  let filledCount = 0;
  let failedCount = 0;

  for (const field of fields) {
    if (!field.proposedValue || field.proposedValue.trim() === '') {
      continue;
    }

    try {
      logger.info(`[FILL] Field "${field.label}" (${field.type}) -> "${field.proposedValue.substring(0, 50)}"`);

      let filled = false;

            if (field.type === 'short-text' || field.type === 'long-text' || field.type === 'unknown') {
        // Use Playwright locators for reliable element finding
        // Strategy 1: Find the question block by label text, then find input inside it
        const labelShort = field.label.substring(0, 50).replace(/["\\]/g, '');
        const questionBlock = page.locator(`.Qr7Oae:has-text("${labelShort}"), .geS5n:has-text("${labelShort}"), [role="listitem"]:has-text("${labelShort}")`).first();

        if (await questionBlock.isVisible({ timeout: 1000 }).catch(() => false)) {
          const inputSelector = field.type === 'long-text' ? 'textarea' : 'input[type="text"], input:not([type])';
          const input = questionBlock.locator(inputSelector).first();
          if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
            await input.scrollIntoViewIfNeeded();
            await input.fill(field.proposedValue);
            filled = true;
          }
        }

        // Strategy 2: Try aria-label
        if (!filled) {
          const ariaInput = page.locator(`input[aria-label*="${labelShort}"], textarea[aria-label*="${labelShort}"]`).first();
          if (await ariaInput.isVisible({ timeout: 500 }).catch(() => false)) {
            await ariaInput.scrollIntoViewIfNeeded();
            await ariaInput.fill(field.proposedValue);
            filled = true;
          }
        }

        // Strategy 3: Find all empty inputs and fill the next one in order
        if (!filled) {
          const allInputs = await page.$$('input[type="text"]:not([aria-hidden="true"]), textarea:not([aria-hidden="true"])');
          for (const input of allInputs) {
            try {
              const isEmpty = await input.evaluate((el: any) => !el.value && el.offsetParent !== null);
              if (isEmpty) {
                await input.scrollIntoViewIfNeeded();
                await input.fill(field.proposedValue);
                filled = true;
                break;
              }
            } catch { /* skip */ }
          }
        }
      }

      if (field.type === 'radio' && !filled) {
        const radioLabel = field.label.substring(0, 40).replace(/["\\]/g, '');
        const radioValue = field.proposedValue.trim();

        // Find question block, then click matching radio inside it
        const radioBlock = page.locator(`[role="listitem"]:has-text("${radioLabel}"), .Qr7Oae:has-text("${radioLabel}")`).first();
        if (await radioBlock.isVisible({ timeout: 1000 }).catch(() => false)) {
          // Try exact data-value match
          const exactMatch = radioBlock.locator(`[data-value="${radioValue}"]`).first();
          if (await exactMatch.isVisible({ timeout: 500 }).catch(() => false)) {
            await exactMatch.scrollIntoViewIfNeeded();
            await exactMatch.click();
            filled = true;
          }
          // Try text match
          if (!filled) {
            const textMatch = radioBlock.locator(`[role="radio"]:has-text("${radioValue}"), .docssharedWizToggleLabeledContent:has-text("${radioValue}")`).first();
            if (await textMatch.isVisible({ timeout: 500 }).catch(() => false)) {
              await textMatch.scrollIntoViewIfNeeded();
              await textMatch.click();
              filled = true;
            }
          }
          // Try partial match (first significant word)
          if (!filled && radioValue.length > 3) {
            const partial = radioValue.substring(0, 15);
            const partialMatch = radioBlock.locator(`[role="radio"]:has-text("${partial}"), .docssharedWizToggleLabeledContent:has-text("${partial}")`).first();
            if (await partialMatch.isVisible({ timeout: 500 }).catch(() => false)) {
              await partialMatch.scrollIntoViewIfNeeded();
              await partialMatch.click();
              filled = true;
            }
          }
          // Last resort: click first unselected radio (for grid/matching questions)
          if (!filled) {
            const unselected = radioBlock.locator('[role="radio"][aria-checked="false"]').first();
            if (await unselected.isVisible({ timeout: 500 }).catch(() => false)) {
              await unselected.scrollIntoViewIfNeeded();
              await unselected.click();
              filled = true;
              logger.debug(`[FILL] Fallback: clicked first unselected radio for grid question`);
            }
          }
        }

        // Page-wide fallback
        if (!filled) {
          const pageRadio = page.locator(`[data-value="${radioValue}"], [role="radio"]:has-text("${radioValue}")`).first();
          if (await pageRadio.isVisible({ timeout: 500 }).catch(() => false)) {
            await pageRadio.scrollIntoViewIfNeeded();
            await pageRadio.click();
            filled = true;
          }
        }
      }

      if (field.type === 'checkbox' && !filled) {
        // Split by comma OR semicolon (AI uses both)
        const selections = field.proposedValue.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 2);
        logger.debug(`[FILL] Checkbox: looking for ${selections.length} options`);

        // Find question block by label text
        const cbLabel = field.label.substring(0, 40).replace(/["\\]/g, '');
        const cbBlock = page.locator(`[role="listitem"]:has-text("${cbLabel}"), .Qr7Oae:has-text("${cbLabel}")`).first();

        if (await cbBlock.isVisible({ timeout: 1000 }).catch(() => false)) {
          const optsCount = await cbBlock.locator('[role="checkbox"], .docssharedWizToggleLabeledContent, .nWQGrd, label').count();
          const optsLocator = cbBlock.locator('[role="checkbox"], .docssharedWizToggleLabeledContent, .nWQGrd, label');
          for (let oi = 0; oi < optsCount; oi++) {
            const opt = optsLocator.nth(oi);
            const text = await opt.textContent().catch(() => '');
            if (text && selections.some(s => text.trim().includes(s) || s.includes(text.trim().substring(0, 15)))) {
              await opt.scrollIntoViewIfNeeded();
              await opt.click();
              filled = true;
              await page.waitForTimeout(200);
            }
          }
        }

        // Fallback: all checkboxes on page
        if (!filled) {
          const allCb = await page.$$('[role="checkbox"], .docssharedWizToggleLabeledContent');
          for (const cb of allCb) {
            const text = await cb.textContent().catch(() => '');
            if (text && selections.some(s => text.trim().includes(s) || s.includes(text.trim().substring(0, 15)))) {
              await cb.scrollIntoViewIfNeeded();
              await cb.click();
              filled = true;
              await page.waitForTimeout(200);
            }
          }
        }
      }

      if (field.type === 'dropdown' && !filled) {
        const dropdown = await page.$('[role="listbox"], select');
        if (dropdown) {
          await dropdown.click();
          await page.waitForTimeout(500);
          const option = page.locator(`[role="option"]:has-text("${field.proposedValue}")`).first();
          if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
            await option.click();
            filled = true;
          }
        }
      }

      // Date fields - Google Forms uses multiple inputs (day, month, year)
      if (field.type === 'date' && !filled) {
        // Try standard date input first
        const dateInput = await page.$('input[type="date"]');
        if (dateInput) {
          await dateInput.fill(field.proposedValue);
          filled = true;
        } else {
          // Google Forms splits dates into separate fields
          const parts = field.proposedValue.split('-'); // YYYY-MM-DD
          if (parts.length === 3) {
            const [year, month, day] = parts;
            // Find date-related inputs near the label
            const allDateInputs = await page.$$('input[type="text"][aria-label*="Day"], input[type="text"][aria-label*="Month"], input[type="text"][aria-label*="Year"], input[data-initial-value]');
            if (allDateInputs.length >= 2) {
              // Typically: Month, Day, Year or Day, Month, Year
              try {
                await allDateInputs[0]!.fill(month!);
                await allDateInputs[1]!.fill(day!);
                if (allDateInputs[2]) await allDateInputs[2]!.fill(year!);
                filled = true;
              } catch {}
            }
            // Fallback: try any inputs in a date container
            if (!filled) {
              const dateInputs = await page.$$('[data-type="9"] input, [aria-label*="date" i] input');
              if (dateInputs.length >= 2) {
                try {
                  await dateInputs[0]!.fill(day!);
                  await dateInputs[1]!.fill(month!);
                  if (dateInputs[2]) await dateInputs[2]!.fill(year!);
                  filled = true;
                } catch {}
              }
            }
          }
        }
        if (filled) logger.info(`[FILL] OK: "${field.label}" (date)`);
      }

      if (filled) {
        filledCount++;
        logger.info(`[FILL] OK: "${field.label}"`);
      } else {
        failedCount++;
        logger.warn(`[FILL] FAILED: "${field.label}" (${field.type}) - could not find matching element`);
      }
    } catch (err) {
      failedCount++;
      logger.error(`[FILL] ERROR: "${field.label}" - ${err}`);
    }

    await page.waitForTimeout(300);
  }

  logger.info(`[FILL] Complete: ${filledCount} filled, ${failedCount} failed`);

  const screenshotPath = await takeScreenshot(page, 'google-form-filled');
  return { success: true, screenshotPath };
}

/**
 * Submit or advance a filled Google Form page.
 * If the current page has a "Next" button, clicks it (advances to next page).
 * If the current page has a "Submit" button, submits the form.
 * Returns hasMorePages: true if there are more pages to fill.
 */
export async function submitGoogleForm(url: string): Promise<{
  success: boolean;
  receiptText: string;
  screenshotPath: string;
  hasMorePages?: boolean;
}> {
  // The form should already be on the page and filled - use current page
  const { getPage: getBrowserPage } = await import('../browser.js');
  const page = await getBrowserPage();

  // Check if there's a "Next" button (more pages after this one)
  const nextSelectors = [
    '[role="button"]:has-text("Next")',
    'div[role="button"]:has-text("Next")',
    'span:has-text("Next")',
    '.appsMaterialWizButtonPaperbuttonLabel:has-text("Next")',
  ];

  for (const selector of nextSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        logger.info('Clicked "Next" - advancing to next page');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
        const screenshotPath = await takeScreenshot(page, 'google-form-next-page');
        return { success: true, receiptText: 'Advanced to next page', screenshotPath, hasMorePages: true };
      }
    } catch {
      // Try next selector
    }
  }

  // No "Next" button found - this is the final page, click Submit
  const submitSelectors = [
    '[role="button"]:has-text("Submit")',
    'div[role="button"]:has-text("Submit")',
    'span:has-text("Submit")',
    '.appsMaterialWizButtonPaperbuttonLabel:has-text("Submit")',
  ];

  let submitted = false;
  for (const selector of submitSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        submitted = true;
        break;
      }
    } catch {
      // Try next
    }
  }

  if (!submitted) {
    await page.keyboard.press('Enter');
  }

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const screenshotPath = await takeScreenshot(page, 'google-form-submitted');
  const receiptText = await extractPageText(page);

  const success =
    receiptText.toLowerCase().includes('response has been recorded') ||
    receiptText.toLowerCase().includes('your response') ||
    receiptText.toLowerCase().includes('thank you') ||
    receiptText.toLowerCase().includes('submitted');

  if (success) {
    logger.success('Google Form submitted successfully');
    logAction(null, 'google_form_submitted', `Form URL: ${url}`);
  } else {
    logger.warn('Google Form submission status uncertain');
  }

  return { success, receiptText, screenshotPath, hasMorePages: false };
}

/**
 * Full Google Form workflow: extract -> preview -> confirm -> fill -> submit.
 * Returns the analysis for the confirmation gate.
 */
export async function processGoogleForm(url: string, options?: { skipNavigation?: boolean }): Promise<FormAnalysis> {
  // Step 1: Extract
  const analysis = await extractGoogleForm(url, options);

  logger.info(`Google Form: "${analysis.title}"`);
  logger.info(`  ${analysis.totalFields} fields total`);
  logger.info(`  ${analysis.autoFilledCount} auto-filled from profile`);
  logger.info(`  ${analysis.aiFilledCount} filled by AI`);
  logger.info(`  ${analysis.manualCount} need manual input`);

  // Emit notification for form detection
  emitNotification({
    type: 'action-required',
    category: 'form-detected',
    title: `Google Form Detected: ${analysis.title}`,
    message: `${analysis.totalFields} fields found. ${analysis.autoFilledCount} auto-filled, ${analysis.aiFilledCount} AI-filled, ${analysis.manualCount} need review.`,
    actionUrl: url,
    actionLabel: 'Review Form',
  });

  return analysis;
}

/**
 * Detect if a URL is a Google Form.
 */
export function isGoogleFormUrl(url: string): boolean {
  return (
    url.includes('docs.google.com/forms') ||
    url.includes('forms.gle') ||
    url.includes('forms.google.com')
  );
}
