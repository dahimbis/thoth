import { describe, it, expect } from 'vitest';
import {
  detectCurrentTerm,
  getAvailableTerms,
  inferTermFromCourseName,
  isCourseInActiveTerm,
} from '../src/scheduler/term-manager.js';

describe('Term Manager', () => {
  describe('detectCurrentTerm', () => {
    it('should detect Spring for February', () => {
      const term = detectCurrentTerm(new Date('2026-02-15'));
      expect(term.name).toBe('Spring 2026');
      expect(term.isCurrent).toBe(true);
    });

    it('should detect Spring for April', () => {
      const term = detectCurrentTerm(new Date('2026-04-27'));
      expect(term.name).toBe('Spring 2026');
    });

    it('should detect Summer for June', () => {
      const term = detectCurrentTerm(new Date('2026-06-15'));
      expect(term.name).toBe('Summer 2026');
    });

    it('should detect Fall for September', () => {
      const term = detectCurrentTerm(new Date('2026-09-01'));
      expect(term.name).toBe('Fall 2026');
    });

    it('should detect Fall for December', () => {
      const term = detectCurrentTerm(new Date('2026-12-01'));
      expect(term.name).toBe('Fall 2026');
    });
  });

  describe('inferTermFromCourseName', () => {
    it('should infer from SP26', () => {
      expect(inferTermFromCourseName('CS-101 SP26')).toBe('Spring 2026');
    });

    it('should infer from FA25', () => {
      expect(inferTermFromCourseName('MATH-201 FA25')).toBe('Fall 2025');
    });

    it('should infer from SU26', () => {
      expect(inferTermFromCourseName('ENG-100 SU26')).toBe('Summer 2026');
    });

    it('should infer from "Spring 2026"', () => {
      expect(inferTermFromCourseName('Intro to CS - Spring 2026')).toBe('Spring 2026');
    });

    it('should infer from "Fall25"', () => {
      expect(inferTermFromCourseName('Physics Fall25')).toBe('Fall 2025');
    });

    it('should return null for no term info', () => {
      expect(inferTermFromCourseName('CS-101 Introduction to Computer Science')).toBeNull();
    });
  });

  describe('getAvailableTerms', () => {
    it('should include current and next term', () => {
      const terms = getAvailableTerms();
      expect(terms.length).toBeGreaterThanOrEqual(2);
      expect(terms[0]!.isCurrent).toBe(true);
    });

    it('should include database terms', () => {
      const terms = getAvailableTerms(['Fall 2024', 'Spring 2025']);
      const names = terms.map((t) => t.name);
      expect(names).toContain('Fall 2024');
      expect(names).toContain('Spring 2025');
    });
  });

  describe('isCourseInActiveTerm', () => {
    it('should match by direct term field', () => {
      expect(isCourseInActiveTerm({ name: 'CS-101', term: 'Spring 2026' }, 'Spring 2026')).toBe(true);
    });

    it('should match by inferred term from name', () => {
      expect(isCourseInActiveTerm({ name: 'CS-101 SP26' }, 'Spring 2026')).toBe(true);
    });

    it('should not match different term', () => {
      expect(isCourseInActiveTerm({ name: 'CS-101', term: 'Fall 2025' }, 'Spring 2026')).toBe(false);
    });
  });

  // PBT: Term filtering correctness
  describe('Property: Term filtering correctness', () => {
    const terms = ['Spring 2025', 'Summer 2025', 'Fall 2025', 'Spring 2026', 'Summer 2026'];
    const courses = terms.map((t) => ({ name: `Course-${t.replace(' ', '')}`, term: t }));

    for (let i = 0; i < 20; i++) {
      const selectedTerm = terms[i % terms.length]!;
      it(`filtering iteration ${i + 1}: only ${selectedTerm} courses pass`, () => {
        const matching = courses.filter((c) => isCourseInActiveTerm(c, selectedTerm));
        const nonMatching = courses.filter((c) => !isCourseInActiveTerm(c, selectedTerm));

        // All matching courses have the selected term
        for (const c of matching) {
          expect(c.term).toBe(selectedTerm);
        }
        // No non-matching courses have the selected term
        for (const c of nonMatching) {
          expect(c.term).not.toBe(selectedTerm);
        }
      });
    }
  });
});
