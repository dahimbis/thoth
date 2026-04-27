import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildPdf } from '../src/documents/pdf-builder.js';
import { existsSync, statSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { OUTPUTS_DIR } from '../src/config.js';

// Ensure demo mode for tests
import { setDemoMode } from '../src/config.js';

beforeAll(() => {
  setDemoMode(true);
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }
});

afterAll(() => {
  // Clean up test files
  const testFiles = ['test-pdf-basic.pdf', 'test-pdf-full.pdf', 'test-pdf-headings.pdf'];
  for (const file of testFiles) {
    const path = resolve(OUTPUTS_DIR, file);
    if (existsSync(path)) rmSync(path);
  }
});

describe('PDF Builder', () => {
  it('should create a PDF file with basic content', async () => {
    const outputPath = await buildPdf({
      title: 'Test Document',
      fileName: 'test-pdf-basic.pdf',
      content: 'This is a simple test paragraph.',
    });

    expect(outputPath).toBe(resolve(OUTPUTS_DIR, 'test-pdf-basic.pdf'));
    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });

  it('should create a PDF with all metadata fields', async () => {
    const outputPath = await buildPdf({
      title: 'Full Metadata Document',
      author: 'Jane Doe',
      course: 'CS-101',
      date: '2026-01-15',
      fileName: 'test-pdf-full.pdf',
      content: 'Content with all metadata fields populated.',
    });

    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });

  it('should handle markdown headings and paragraphs', async () => {
    const content = `# Introduction

This is the introduction paragraph.

## Methods

We used the following methods.

### Sub-section

Details here with **bold** and *italic* text.`;

    const outputPath = await buildPdf({
      title: 'Headings Test',
      fileName: 'test-pdf-headings.pdf',
      content,
    });

    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });
});
