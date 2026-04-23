import { type Page } from 'playwright';
import { generateText } from 'ai';
import { navigateTo, takeScreenshot } from '../browser.js';
import { extractPageText } from '../vision.js';
import { getQuickModel } from '../../agent/providers.js';
import { getStudentProfile, type StudentProfile } from '../../config.js';
import { logger } from '../../ui/logger.js';
import { logAction } from '../../db/queries.js';

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
  {
    patterns: [
      /\b(full\s*name|your\s*name|name)\b/i,
      /^name$/i,
    ],
    profileKey: 'fullName',
  },
  {
    patterns: [
      /\b(first\s*name|given\s*name)\b/i,
    ],
    profileKey: 'firstName',
  },
  {
    patterns: [
      /\b(last\s*name|family\s*name|surname)\b/i,
    ],
    profileKey: 'lastName',
  },
  {
    patterns: [
      /\b(email|e-mail|email\s*address)\b/i,
      /^email$/i,
    ],
    profileKey: 'email',
  },
  {
    patterns: [
      /\b(student\s*id|net\s*id|n-?number|university\s*id|id\s*number)\b/i,
      /\bN\d+\b/i, // Matches "N12345678" pattern in labels
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
 * Navigate to a Google Form and extract all fields.
 */
export async function extractGoogleForm(url: string): Promise<FormAnalysis> {
  logger.info(`Extracting Google Form: ${url}`);
  const page = await navigateTo(url, { waitUntil: 'networkidle' });

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

  // Extract all form fields
  const rawFields = await extractFormFields(page);

  // Match profile fields and generate AI answers
  const profile = getStudentProfile();
  const fields = await processFields(rawFields, profile, page);

  const autoFilledCount = fields.filter((f) => f.autoFilled).length;
  const aiFilledCount = fields.filter((f) => f.aiGenerated).length;
  const manualCount = fields.filter((f) => !f.autoFilled && !f.aiGenerated && f.required).length;

  logger.info(
    `Form "${formData.title}": ${fields.length} fields — ${autoFilledCount} auto-filled, ${aiFilledCount} AI-filled, ${manualCount} need manual input`,
  );

  return {
    ...formData,
    fields,
    totalFields: fields.length,
    autoFilledCount,
    aiFilledCount,
    manualCount,
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
    for (const container of containers) {
      // Extract label
      const labelEl = container.querySelector(
        '[class*="exportItemTitle"], .M7eMe, [data-initial-value], span[class*="M7eMe"]',
      );
      const label = labelEl?.textContent?.trim() ?? '';
      if (!label || label.length < 2) continue;

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

  const { text } = await generateText({
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
 * Call this AFTER user confirms the preview.
 */
export async function fillGoogleForm(
  url: string,
  fields: FormField[],
): Promise<{ success: boolean; screenshotPath: string }> {
  const page = await navigateTo(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  logger.info(`Filling ${fields.length} form fields...`);

  // Get all question containers
  const containers = await page.$$('[class*="freebirdFormviewerComponentsQuestionBase"], .Qr7Oae, .geS5n, [role="listitem"]');

  for (const field of fields) {
    if (!field.proposedValue || field.proposedValue.trim() === '') continue;

    try {
      const container = containers[field.index];
      if (!container) {
        logger.warn(`Container not found for field ${field.index}: "${field.label}"`);
        continue;
      }

      switch (field.type) {
        case 'short-text': {
          const input = await container.$('input[type="text"], input:not([type])');
          if (input) {
            await input.fill(field.proposedValue);
          }
          break;
        }

        case 'long-text': {
          const textarea = await container.$('textarea');
          if (textarea) {
            await textarea.fill(field.proposedValue);
          }
          break;
        }

        case 'radio': {
          // Find the radio option matching our answer
          const radioLabels = await container.$$('[data-value], .docssharedWizToggleLabeledContent, .nWQGrd');
          for (const label of radioLabels) {
            const text = await label.textContent();
            if (text?.trim() === field.proposedValue.trim()) {
              await label.click();
              break;
            }
          }
          break;
        }

        case 'checkbox': {
          // May need to select multiple options (comma-separated in proposedValue)
          const selections = field.proposedValue.split(',').map((s) => s.trim());
          const checkLabels = await container.$$('[data-value], .docssharedWizToggleLabeledContent, .nWQGrd');
          for (const label of checkLabels) {
            const text = await label.textContent();
            if (text && selections.includes(text.trim())) {
              await label.click();
            }
          }
          break;
        }

        case 'dropdown': {
          const dropdown = await container.$('[role="listbox"], select');
          if (dropdown) {
            await dropdown.click();
            await page.waitForTimeout(500);
            // Click the matching option
            const option = page.locator(`[role="option"]:has-text("${field.proposedValue}")`).first();
            if (await option.isVisible({ timeout: 2000 })) {
              await option.click();
            }
          }
          break;
        }

        case 'date': {
          const dateInput = await container.$('input[type="date"], input');
          if (dateInput) {
            await dateInput.fill(field.proposedValue);
          }
          break;
        }

        case 'linear-scale': {
          // Click the matching scale value
          const scaleOptions = await container.$$('[data-value], [role="radio"]');
          for (const opt of scaleOptions) {
            const value = await opt.getAttribute('data-value');
            if (value === field.proposedValue) {
              await opt.click();
              break;
            }
          }
          break;
        }

        default: {
          // Try generic text input
          const anyInput = await container.$('input, textarea');
          if (anyInput) {
            await anyInput.fill(field.proposedValue);
          }
        }
      }

      logger.debug(`Filled field ${field.index}: "${field.label}" = "${field.proposedValue.substring(0, 50)}"`);
    } catch (err) {
      logger.warn(`Failed to fill field ${field.index} ("${field.label}"): ${err}`);
    }
  }

  const screenshotPath = await takeScreenshot(page, 'google-form-filled');
  return { success: true, screenshotPath };
}

/**
 * Submit a filled Google Form.
 */
export async function submitGoogleForm(url: string): Promise<{
  success: boolean;
  receiptText: string;
  screenshotPath: string;
}> {
  // The form should already be on the page and filled
  const page = await navigateTo(url, { waitUntil: 'networkidle' });

  // Find and click submit button
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
    // Fallback: press Enter
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

  return { success, receiptText, screenshotPath };
}

/**
 * Full Google Form workflow: extract -> preview -> confirm -> fill -> submit.
 * Returns the analysis for the confirmation gate.
 */
export async function processGoogleForm(url: string): Promise<FormAnalysis> {
  // Step 1: Extract
  const analysis = await extractGoogleForm(url);

  logger.info(`Google Form: "${analysis.title}"`);
  logger.info(`  ${analysis.totalFields} fields total`);
  logger.info(`  ${analysis.autoFilledCount} auto-filled from profile`);
  logger.info(`  ${analysis.aiFilledCount} filled by AI`);
  logger.info(`  ${analysis.manualCount} need manual input`);

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
