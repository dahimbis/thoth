import { type Page } from 'playwright';
import { getConfig } from '../../config.js';
import { navigateTo, takeScreenshot } from '../browser.js';
import { extractPageText } from '../vision.js';
import { getBrightspaceClient } from '../../api/client.js';
import { logger } from '../../ui/logger.js';
import { logAction } from '../../db/queries.js';

export interface CourseInfo {
  name: string;
  orgUnitId: string;
  url: string;
  term?: string;
}

/**
 * Discover all active enrolled courses.
 * Primary: Brightspace REST API
 * Fallback: Browser scraping
 */
export async function discoverCourses(): Promise<CourseInfo[]> {
  logger.info('Discovering enrolled courses...');

  try {
    return await discoverCoursesViaApi();
  } catch (err) {
    logger.warn(`API course discovery failed: ${err}. Falling back to browser.`);
    return discoverCoursesViaBrowser();
  }
}

/**
 * Discover courses via Brightspace REST API.
 */
async function discoverCoursesViaApi(): Promise<CourseInfo[]> {
  const client = getBrightspaceClient();
  const baseUrl = getConfig().BRIGHTSPACE_BASE_URL;
  const enrollments = await client.getMyEnrollments();

  const courses: CourseInfo[] = [];

  for (const enrollment of enrollments) {
    const e = enrollment as {
      OrgUnit?: {
        Id?: number;
        Name?: string;
        Type?: { Id?: number; Name?: string };
      };
      Access?: { IsActive?: boolean };
    };

    // Filter to active course offerings (type 3 = Course Offering in D2L)
    if (!e.Access?.IsActive) continue;
    if (e.OrgUnit?.Type?.Id !== 3) continue;

    const orgId = e.OrgUnit?.Id;
    const name = e.OrgUnit?.Name;

    if (orgId && name) {
      courses.push({
        name,
        orgUnitId: String(orgId),
        url: `${baseUrl}/d2l/home/${orgId}`,
      });
    }
  }

  logger.success(`Found ${courses.length} active courses via API`);
  logAction(null, 'course_discovery', `Found ${courses.length} courses via API`);

  return courses;
}

/**
 * Discover courses by scraping the Brightspace homepage.
 * Used as fallback when API fails.
 */
async function discoverCoursesViaBrowser(): Promise<CourseInfo[]> {
  const config = getConfig();
  const page = await navigateTo(`${config.BRIGHTSPACE_BASE_URL}/d2l/home`, {
    waitUntil: 'networkidle',
  });

  await takeScreenshot(page, 'home-page');

  const courses = await page.evaluate((baseUrl: string) => {
    const results: Array<{ name: string; orgUnitId: string; url: string }> = [];

    // Strategy 1: Look for course cards/widgets
    const courseLinks = document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/d2l/home/"], .d2l-card a, .course-card a, [class*="course"] a',
    );

    for (const link of courseLinks) {
      const href = link.getAttribute('href') ?? '';
      const match = href.match(/\/d2l\/home\/(\d+)/);
      if (match?.[1]) {
        const name = link.textContent?.trim() ?? '';
        if (name && name.length > 2) {
          results.push({
            name,
            orgUnitId: match[1],
            url: `${baseUrl}/d2l/home/${match[1]}`,
          });
        }
      }
    }

    // Deduplicate by orgUnitId
    const seen = new Set<string>();
    return results.filter((c) => {
      if (seen.has(c.orgUnitId)) return false;
      seen.add(c.orgUnitId);
      return true;
    });
  }, config.BRIGHTSPACE_BASE_URL);

  logger.success(`Found ${courses.length} courses via browser`);
  logAction(null, 'course_discovery', `Found ${courses.length} courses via browser scraping`);

  return courses;
}

/**
 * Detect the current academic term from the Brightspace homepage.
 */
export async function detectCurrentTerm(): Promise<string> {
  const config = getConfig();
  const page = await navigateTo(`${config.BRIGHTSPACE_BASE_URL}/d2l/home`);
  const text = await extractPageText(page);

  // Look for common term patterns
  const termPatterns = [
    /(?:Spring|Summer|Fall|Winter)\s+\d{4}/i,
    /(?:SP|SU|FA|WI)\s*\d{2,4}/i,
    /\d{4}\s+(?:Spring|Summer|Fall|Winter)/i,
  ];

  for (const pattern of termPatterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0];
  }

  // Infer from current date
  const month = new Date().getMonth();
  const year = new Date().getFullYear();
  if (month >= 0 && month <= 4) return `Spring ${year}`;
  if (month >= 5 && month <= 7) return `Summer ${year}`;
  return `Fall ${year}`;
}
