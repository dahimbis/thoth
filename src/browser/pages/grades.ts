import { getConfig } from '../../config.js';
import { navigateTo, takeScreenshot } from '../browser.js';
import { extractPageText } from '../vision.js';
import { getBrightspaceClient } from '../../api/client.js';
import { logger } from '../../ui/logger.js';

export interface GradeInfo {
  title: string;
  gradeObjectId: string;
  pointsNumerator: number | null;
  pointsDenominator: number | null;
  percentage: number | null;
  feedback: string | null;
}

/**
 * Get all grades for a course.
 */
export async function getGrades(orgUnitId: string, courseName: string): Promise<GradeInfo[]> {
  logger.info('Checking grades...', { course: courseName });

  try {
    return await getGradesViaApi(orgUnitId, courseName);
  } catch (err) {
    logger.warn(`API grade check failed: ${err}. Falling back to browser.`, { course: courseName });
    return getGradesViaBrowser(orgUnitId, courseName);
  }
}

async function getGradesViaApi(orgUnitId: string, courseName: string): Promise<GradeInfo[]> {
  const client = getBrightspaceClient();
  const gradeObjects = await client.getGradeObjects(orgUnitId);
  const results: GradeInfo[] = [];

  for (const gradeObj of gradeObjects) {
    const g = gradeObj as {
      Id?: number;
      Name?: string;
      MaxPoints?: number;
    };

    if (!g.Id || !g.Name) continue;

    try {
      const myGrade = (await client.getMyGrade(orgUnitId, String(g.Id))) as {
        PointsNumerator?: number;
        PointsDenominator?: number;
        DisplayedGrade?: { DisplayedGrade?: string };
        GradeObjectName?: string;
      };

      results.push({
        title: g.Name,
        gradeObjectId: String(g.Id),
        pointsNumerator: myGrade.PointsNumerator ?? null,
        pointsDenominator: myGrade.PointsDenominator ?? null,
        percentage:
          myGrade.PointsNumerator != null && myGrade.PointsDenominator
            ? Math.round((myGrade.PointsNumerator / myGrade.PointsDenominator) * 100)
            : null,
        feedback: null,
      });
    } catch {
      // Grade not yet available
      results.push({
        title: g.Name,
        gradeObjectId: String(g.Id),
        pointsNumerator: null,
        pointsDenominator: g.MaxPoints ?? null,
        percentage: null,
        feedback: null,
      });
    }
  }

  logger.info(`Retrieved ${results.length} grade items via API`, { course: courseName });
  return results;
}

async function getGradesViaBrowser(orgUnitId: string, courseName: string): Promise<GradeInfo[]> {
  const config = getConfig();
  const page = await navigateTo(
    `${config.BRIGHTSPACE_BASE_URL}/d2l/lms/grades/my_grades/main.d2l?ou=${orgUnitId}`,
    { waitUntil: 'networkidle' },
  );

  await takeScreenshot(page, `grades-${orgUnitId}`);

  const grades = await page.evaluate(() => {
    const results: GradeInfo[] = [];
    const rows = document.querySelectorAll('table tbody tr, .d2l-grades-row');

    for (const row of rows) {
      const cells = row.querySelectorAll('td, .d2l-grades-cell');
      const title = cells[0]?.textContent?.trim() ?? '';
      if (!title || title === 'Grade Item') continue;

      const gradeText = cells[1]?.textContent?.trim() ?? '';
      const percentText = cells[2]?.textContent?.trim() ?? '';

      // Parse grade like "85 / 100"
      const gradeMatch = gradeText.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      const percentMatch = percentText.match(/(\d+(?:\.\d+)?)/);

      results.push({
        title,
        gradeObjectId: '',
        pointsNumerator: gradeMatch ? parseFloat(gradeMatch[1]!) : null,
        pointsDenominator: gradeMatch ? parseFloat(gradeMatch[2]!) : null,
        percentage: percentMatch ? parseFloat(percentMatch[1]!) : null,
        feedback: null,
      });
    }

    return results;
  });

  logger.info(`Retrieved ${grades.length} grade items via browser`, { course: courseName });
  return grades;
}
