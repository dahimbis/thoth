import { type Page } from 'playwright';
import { getConfig } from '../../config.js';
import { navigateTo, takeScreenshot } from '../browser.js';
import { extractPageText } from '../vision.js';
import { getBrightspaceClient } from '../../api/client.js';
import { logger } from '../../ui/logger.js';
import { logAction } from '../../db/queries.js';

export interface AssignmentInfo {
  title: string;
  lmsItemId: string;
  deadline: string; // ISO 8601
  status: 'not-submitted' | 'submitted' | 'graded';
  pointsValue: number | null;
  submissionUrl: string;
  type: string; // raw type from LMS, will be classified later
}

/**
 * Scan all assignments (dropbox folders) for a course.
 * Primary: API. Fallback: Browser.
 */
export async function scanAssignments(orgUnitId: string, courseName: string): Promise<AssignmentInfo[]> {
  logger.info('Scanning assignments...', { course: courseName });

  try {
    return await scanAssignmentsViaApi(orgUnitId, courseName);
  } catch (err) {
    logger.warn(`API assignment scan failed: ${err}. Falling back to browser.`, { course: courseName });
    return scanAssignmentsViaBrowser(orgUnitId, courseName);
  }
}

async function scanAssignmentsViaApi(orgUnitId: string, courseName: string): Promise<AssignmentInfo[]> {
  const client = getBrightspaceClient();
  const baseUrl = getConfig().BRIGHTSPACE_BASE_URL;
  const folders = await client.getDropboxFolders(orgUnitId);

  const assignments: AssignmentInfo[] = [];

  for (const folder of folders) {
    const f = folder as {
      Id?: number;
      Name?: string;
      DueDate?: string;
      TotalScore?: number;
      Instructions?: { Html?: string };
      Availability?: { StartDate?: string; EndDate?: string };
    };

    if (!f.Id || !f.Name) continue;

    // Parse deadline
    let deadline = f.DueDate ?? f.Availability?.EndDate ?? '';
    if (!deadline) {
      // If no deadline, set a far-future date
      deadline = '2099-12-31T23:59:59Z';
    }

    assignments.push({
      title: f.Name,
      lmsItemId: String(f.Id),
      deadline,
      status: 'not-submitted', // Will be refined later
      pointsValue: f.TotalScore ?? null,
      submissionUrl: `${baseUrl}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.Id}&grpid=0&isprv=0&bp=0&ou=${orgUnitId}`,
      type: 'dropbox',
    });
  }

  logger.info(`Found ${assignments.length} assignments via API`, { course: courseName });
  logAction(null, 'assignment_scan', `${courseName}: ${assignments.length} assignments via API`);
  return assignments;
}

async function scanAssignmentsViaBrowser(orgUnitId: string, courseName: string): Promise<AssignmentInfo[]> {
  const config = getConfig();
  const page = await navigateTo(
    `${config.BRIGHTSPACE_BASE_URL}/d2l/lms/dropbox/user/folders_list.d2l?ou=${orgUnitId}`,
    { waitUntil: 'networkidle' },
  );

  await takeScreenshot(page, `assignments-${orgUnitId}`);

  const assignments = await page.evaluate((baseUrl: string) => {
    const results: AssignmentInfo[] = [];
    const rows = document.querySelectorAll('table tr, .d2l-datalist-item, [class*="assignment"]');

    for (const row of rows) {
      const linkEl = row.querySelector<HTMLAnchorElement>('a[href*="folder_submit"], a[href*="dropbox"]');
      const titleEl = row.querySelector('.d2l-foldername, .d2l-heading, th a, td:first-child a');
      const dateEl = row.querySelector('.d2l-dates, [class*="date"], td:nth-child(2)');

      const title = titleEl?.textContent?.trim() ?? linkEl?.textContent?.trim();
      if (!title) continue;

      const href = linkEl?.getAttribute('href') ?? '';
      const idMatch = href.match(/db=(\d+)/);
      const lmsItemId = idMatch?.[1] ?? '';

      // Parse date text
      let deadline = '';
      const dateText = dateEl?.textContent?.trim() ?? '';
      if (dateText) {
        try {
          deadline = new Date(dateText).toISOString();
        } catch {
          deadline = dateText;
        }
      }

      results.push({
        title,
        lmsItemId,
        deadline: deadline || '2099-12-31T23:59:59Z',
        status: 'not-submitted' as const,
        pointsValue: null,
        submissionUrl: href.startsWith('http') ? href : `${baseUrl}${href}`,
        type: 'dropbox',
      });
    }

    return results;
  }, config.BRIGHTSPACE_BASE_URL);

  logger.info(`Found ${assignments.length} assignments via browser`, { course: courseName });
  return assignments;
}

/**
 * Navigate to a specific assignment page and extract full details.
 */
export async function getAssignmentDetails(
  orgUnitId: string,
  folderId: string,
): Promise<{
  instructions: string;
  rubric: string | null;
  fileFormat: string | null;
  wordLimit: string | null;
  citationStyle: string | null;
  attachments: string[];
}> {
  const config = getConfig();
  const page = await navigateTo(
    `${config.BRIGHTSPACE_BASE_URL}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folderId}&grpid=0&isprv=0&bp=0&ou=${orgUnitId}`,
    { waitUntil: 'networkidle' },
  );

  await takeScreenshot(page, `assignment-detail-${folderId}`);

  // Extract instructions from the page
  const instructions = await page.evaluate(() => {
    const instrEl =
      document.querySelector('.d2l-htmlblock, .d2l-richtext, [class*="instructions"], .d2l-html-block') ??
      document.querySelector('.d2l-page-main');
    return instrEl?.textContent?.trim() ?? '';
  });

  // Look for rubric
  const rubric = await page.evaluate(() => {
    const rubricEl = document.querySelector('[class*="rubric"], #rubric, .d2l-rubric');
    return rubricEl?.textContent?.trim() ?? null;
  });

  // Look for file format requirements in the text
  const text = instructions.toLowerCase();
  let fileFormat: string | null = null;
  if (text.includes('.pdf')) fileFormat = 'pdf';
  else if (text.includes('.docx') || text.includes('word document')) fileFormat = 'docx';
  else if (text.includes('.zip')) fileFormat = 'zip';
  else if (text.includes('.py') || text.includes('python')) fileFormat = 'py';

  // Word limit
  let wordLimit: string | null = null;
  const wordMatch = text.match(/(\d+)\s*(?:word|words)/);
  if (wordMatch) wordLimit = wordMatch[0]!;
  const pageMatch = text.match(/(\d+)\s*(?:page|pages)/);
  if (!wordLimit && pageMatch) wordLimit = pageMatch[0]!;

  // Citation style
  let citationStyle: string | null = null;
  if (text.includes('apa')) citationStyle = 'APA';
  else if (text.includes('mla')) citationStyle = 'MLA';
  else if (text.includes('chicago')) citationStyle = 'Chicago';

  // Attachments/starter files
  const attachments = await page.evaluate(() => {
    const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="viewContent"], a[href*="download"]');
    return Array.from(links).map((l) => l.getAttribute('href') ?? '').filter(Boolean);
  });

  return { instructions, rubric, fileFormat, wordLimit, citationStyle, attachments };
}

/**
 * Submit a file to an assignment via the browser (fallback for API upload).
 */
export async function submitAssignmentViaBrowser(
  orgUnitId: string,
  folderId: string,
  filePath: string,
): Promise<{ success: boolean; receiptText: string; screenshotPath: string }> {
  const config = getConfig();
  const page = await navigateTo(
    `${config.BRIGHTSPACE_BASE_URL}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folderId}&grpid=0&isprv=0&bp=0&ou=${orgUnitId}`,
    { waitUntil: 'networkidle' },
  );

  // Find the file input and upload
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath);

  logger.info(`File selected for upload: ${filePath}`);

  // Wait for upload processing
  await page.waitForTimeout(2000);

  // Click submit
  const submitButton = page.locator(
    'button:has-text("Submit"), input[value*="Submit"], button[type="submit"], .d2l-button-primary',
  ).first();

  await submitButton.click();
  await page.waitForLoadState('networkidle');

  // Handle confirmation dialog if present
  try {
    const confirmBtn = page.locator('button:has-text("Submit"), button:has-text("Yes")').first();
    if (await confirmBtn.isVisible({ timeout: 3000 })) {
      await confirmBtn.click();
      await page.waitForLoadState('networkidle');
    }
  } catch {
    // No confirmation dialog
  }

  const screenshotPath = await takeScreenshot(page, `submission-receipt-${folderId}`);
  const receiptText = await extractPageText(page);

  // Check for success indicators
  const success =
    receiptText.toLowerCase().includes('submitted') ||
    receiptText.toLowerCase().includes('success') ||
    receiptText.toLowerCase().includes('received');

  return { success, receiptText, screenshotPath };
}
