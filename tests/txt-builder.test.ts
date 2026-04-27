import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTxt, stripMarkdownFormatting } from '../src/documents/txt-builder.js';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { OUTPUTS_DIR, setDemoMode } from '../src/config.js';

beforeAll(() => {
  setDemoMode(true);
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }
});

afterAll(() => {
  const testFiles = ['test-txt-basic.txt', 'test-txt-full.txt', 'test-txt-roundtrip.txt'];
  for (const file of testFiles) {
    const path = resolve(OUTPUTS_DIR, file);
    if (existsSync(path)) rmSync(path);
  }
});

describe('TXT Builder', () => {
  it('should create a plain text file with basic content', async () => {
    const outputPath = await buildTxt({
      title: 'Test Document',
      fileName: 'test-txt-basic.txt',
      content: 'This is plain text content.',
    });

    expect(outputPath).toBe(resolve(OUTPUTS_DIR, 'test-txt-basic.txt'));
    expect(existsSync(outputPath)).toBe(true);

    const text = readFileSync(outputPath, 'utf-8');
    expect(text).toContain('Test Document');
    expect(text).toContain('This is plain text content.');
  });

  it('should include all metadata in the header', async () => {
    const outputPath = await buildTxt({
      title: 'Full Metadata',
      author: 'Jane Doe',
      course: 'CS-101',
      date: '2026-01-15',
      fileName: 'test-txt-full.txt',
      content: 'Body content here.',
    });

    const text = readFileSync(outputPath, 'utf-8');
    expect(text).toContain('Full Metadata');
    expect(text).toContain('Jane Doe');
    expect(text).toContain('CS-101');
    expect(text).toContain('2026-01-15');
    expect(text).toContain('Body content here.');
  });

  it('should produce a round-trip identical content', async () => {
    const originalContent = 'Line one.\nLine two.\nLine three.';
    const outputPath = await buildTxt({
      title: 'Round Trip',
      fileName: 'test-txt-roundtrip.txt',
      content: originalContent,
    });

    const text = readFileSync(outputPath, 'utf-8');
    // Content should appear after the header block
    expect(text).toContain(originalContent);
  });
});

describe('stripMarkdownFormatting', () => {
  it('should strip heading markers', () => {
    expect(stripMarkdownFormatting('# Heading 1')).toBe('Heading 1');
    expect(stripMarkdownFormatting('## Heading 2')).toBe('Heading 2');
    expect(stripMarkdownFormatting('### Heading 3')).toBe('Heading 3');
  });

  it('should strip bold markers', () => {
    expect(stripMarkdownFormatting('This is **bold** text')).toBe('This is bold text');
    expect(stripMarkdownFormatting('This is __bold__ text')).toBe('This is bold text');
  });

  it('should strip italic markers', () => {
    expect(stripMarkdownFormatting('This is *italic* text')).toBe('This is italic text');
    expect(stripMarkdownFormatting('This is _italic_ text')).toBe('This is italic text');
  });

  it('should strip inline code backticks', () => {
    expect(stripMarkdownFormatting('Use `console.log` here')).toBe('Use console.log here');
  });

  it('should handle multiple formatting in one line', () => {
    const input = '# **Bold Heading** with *italic* and `code`';
    const result = stripMarkdownFormatting(input);
    expect(result).toBe('Bold Heading with italic and code');
  });

  it('should preserve plain text unchanged', () => {
    const plain = 'This is just plain text with no formatting.';
    expect(stripMarkdownFormatting(plain)).toBe(plain);
  });
});
