import { describe, it, expect } from 'vitest';
import { generateFileName } from '../src/documents/docx-builder.js';

describe('DOCX Builder', () => {
  describe('generateFileName', () => {
    it('should generate filename with all parts', () => {
      const result = generateFileName('John Smith', 'CS-101', 'Homework 1');
      expect(result).toBe('Smith_CS-101_Homework_1.docx');
    });

    it('should generate filename without student name', () => {
      const result = generateFileName(undefined, 'CS-101', 'Final Essay');
      expect(result).toBe('CS-101_Final_Essay.docx');
    });

    it('should generate filename without course code', () => {
      const result = generateFileName('Jane Doe', undefined, 'Research Paper');
      expect(result).toBe('Doe_Research_Paper.docx');
    });

    it('should handle custom extension', () => {
      const result = generateFileName('Bob', 'CS-201', 'Lab Report', 'pdf');
      expect(result).toBe('Bob_CS-201_Lab_Report.pdf');
    });

    it('should sanitize special characters from title', () => {
      const result = generateFileName(undefined, undefined, 'Assignment #3: Analysis & Review!');
      expect(result).not.toContain('#');
      expect(result).not.toContain('!');
      expect(result).not.toContain('&');
      expect(result).not.toContain(':');
      expect(result.endsWith('.docx')).toBe(true);
    });

    it('should truncate long titles', () => {
      const longTitle = 'A'.repeat(100);
      const result = generateFileName(undefined, undefined, longTitle);
      // Title should be max 50 chars + .docx
      expect(result.length).toBeLessThanOrEqual(55);
    });

    it('should handle multi-word last name', () => {
      const result = generateFileName('Maria De La Cruz', 'HIST-200', 'Essay');
      expect(result).toBe('Cruz_HIST-200_Essay.docx');
    });
  });
});
