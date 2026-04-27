/**
 * Term Manager  - academic term detection, selection, and course filtering.
 *
 * Handles:
 * - Detecting the current academic term from the date
 * - Inferring terms from course names (SP26, FA25, etc.)
 * - Persisting the active term selection in the database
 * - Filtering courses/assignments by the active term
 */

// ── Interfaces ───────────────────────────────────────

export interface AcademicTerm {
  name: string;          // e.g., "Spring 2026"
  startDate: string;     // ISO 8601
  endDate: string;       // ISO 8601
  isCurrent: boolean;
}

// ── Term Detection ───────────────────────────────────

/**
 * Detect the current academic term based on the current date.
 * - Jan 15 – May 31 → Spring
 * - Jun 1 – Aug 15 → Summer
 * - Aug 16 – Jan 14 → Fall
 */
export function detectCurrentTerm(now: Date = new Date()): AcademicTerm {
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  const year = now.getFullYear();

  if ((month === 1 && day >= 15) || (month >= 2 && month <= 4) || (month === 5)) {
    return {
      name: `Spring ${year}`,
      startDate: `${year}-01-15`,
      endDate: `${year}-05-31`,
      isCurrent: true,
    };
  }

  if (month === 6 || month === 7 || (month === 8 && day <= 15)) {
    return {
      name: `Summer ${year}`,
      startDate: `${year}-06-01`,
      endDate: `${year}-08-15`,
      isCurrent: true,
    };
  }

  // Fall: Aug 16 – Jan 14 (next year for Dec/Jan)
  if (month >= 8 || month === 1 || (month === 1 && day < 15)) {
    const fallYear = month >= 8 ? year : year - 1;
    return {
      name: `Fall ${fallYear}`,
      startDate: `${fallYear}-08-16`,
      endDate: `${fallYear + 1}-01-14`,
      isCurrent: true,
    };
  }

  // Fallback
  return {
    name: `Spring ${year}`,
    startDate: `${year}-01-15`,
    endDate: `${year}-05-31`,
    isCurrent: true,
  };
}

/**
 * Get available terms: current term, next term, and any terms found in the database.
 */
export function getAvailableTerms(dbTerms: string[] = []): AcademicTerm[] {
  const current = detectCurrentTerm();
  const next = getNextTerm(current);

  const terms: AcademicTerm[] = [
    current,
    { ...next, isCurrent: false },
  ];

  // Add any database terms not already in the list
  const termNames = new Set(terms.map((t) => t.name));
  for (const dbTerm of dbTerms) {
    if (!termNames.has(dbTerm)) {
      termNames.add(dbTerm);
      terms.push({
        name: dbTerm,
        startDate: '',
        endDate: '',
        isCurrent: false,
      });
    }
  }

  return terms;
}

/**
 * Get the next academic term after the given one.
 */
function getNextTerm(current: AcademicTerm): AcademicTerm {
  if (current.name.startsWith('Spring')) {
    const year = parseInt(current.name.split(' ')[1]!, 10);
    return { name: `Summer ${year}`, startDate: `${year}-06-01`, endDate: `${year}-08-15`, isCurrent: false };
  }
  if (current.name.startsWith('Summer')) {
    const year = parseInt(current.name.split(' ')[1]!, 10);
    return { name: `Fall ${year}`, startDate: `${year}-08-16`, endDate: `${year + 1}-01-14`, isCurrent: false };
  }
  // Fall → Spring next year
  const year = parseInt(current.name.split(' ')[1]!, 10);
  return { name: `Spring ${year + 1}`, startDate: `${year + 1}-01-15`, endDate: `${year + 1}-05-31`, isCurrent: false };
}

// ── Course Name Inference ────────────────────────────

/**
 * Infer the academic term from a course name using common patterns.
 *
 * Patterns matched:
 * - SP26, SP2026 → Spring 2026
 * - FA25, FA2025 → Fall 2025
 * - SU26, SU2026 → Summer 2026
 * - "Spring 2026", "Fall 2025", "Summer 2026"
 * - "Spring26", "Fall25", "Summer26"
 */
export function inferTermFromCourseName(courseName: string): string | null {
  const upper = courseName.toUpperCase();

  // Match SP26, FA25, SU26 (2-digit year)
  const shortMatch = upper.match(/\b(SP|FA|SU)(\d{2})\b/);
  if (shortMatch) {
    const [, prefix, yearStr] = shortMatch;
    const year = 2000 + parseInt(yearStr!, 10);
    const season = prefix === 'SP' ? 'Spring' : prefix === 'FA' ? 'Fall' : 'Summer';
    return `${season} ${year}`;
  }

  // Match SP2026, FA2025, SU2026 (4-digit year)
  const longMatch = upper.match(/\b(SP|FA|SU)(\d{4})\b/);
  if (longMatch) {
    const [, prefix, yearStr] = longMatch;
    const year = parseInt(yearStr!, 10);
    const season = prefix === 'SP' ? 'Spring' : prefix === 'FA' ? 'Fall' : 'Summer';
    return `${season} ${year}`;
  }

  // Match "Spring 2026", "Fall 2025", "Summer 2026"
  const fullMatch = courseName.match(/\b(Spring|Fall|Summer)\s*(\d{4})\b/i);
  if (fullMatch) {
    const season = fullMatch[1]!.charAt(0).toUpperCase() + fullMatch[1]!.slice(1).toLowerCase();
    return `${season} ${fullMatch[2]}`;
  }

  // Match "Spring26", "Fall25", "Summer26"
  const shortFullMatch = courseName.match(/\b(Spring|Fall|Summer)\s*(\d{2})\b/i);
  if (shortFullMatch) {
    const season = shortFullMatch[1]!.charAt(0).toUpperCase() + shortFullMatch[1]!.slice(1).toLowerCase();
    const year = 2000 + parseInt(shortFullMatch[2]!, 10);
    return `${season} ${year}`;
  }

  return null;
}

/**
 * Check if a course belongs to the active term.
 */
export function isCourseInActiveTerm(
  course: { name: string; startDate?: string; endDate?: string; term?: string },
  activeTerm: string,
): boolean {
  // Direct term match
  if (course.term && course.term === activeTerm) return true;

  // Infer from course name
  const inferred = inferTermFromCourseName(course.name);
  if (inferred === activeTerm) return true;

  // Check date range if available
  if (course.startDate && course.endDate) {
    const termFromDates = detectTermFromDates(course.startDate, course.endDate);
    if (termFromDates === activeTerm) return true;
  }

  return false;
}

/**
 * Detect term from course start/end dates.
 */
function detectTermFromDates(startDate: string, endDate: string): string | null {
  const start = new Date(startDate);
  const startMonth = start.getMonth() + 1;
  const year = start.getFullYear();

  if (startMonth >= 1 && startMonth <= 3) return `Spring ${year}`;
  if (startMonth >= 5 && startMonth <= 7) return `Summer ${year}`;
  if (startMonth >= 8 && startMonth <= 10) return `Fall ${year}`;

  return null;
}
