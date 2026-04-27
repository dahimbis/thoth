import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildMd, buildFrontMatter } from '../src/documents/md-builder.js';
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
  const testFiles = ['test-md-basic.md', 'test-md-full.md', 'test-md-preserve.md'];
  for (const file of testFiles) {
    const path = resolve(OUTPUTS_DIR, file);
    if (existsSync(path)) rmSync(path);
  }
});

describe('MD Builder', () => {
  it('should create a markdown file with front-matter and content', async () => {
    const outputPath = await buildMd({
      title: 'Test Document',
      fileName: 'test-md-basic.md',
      content: '# Introduction\n\nThis is the body.',
    });

    expect(outputPath).toBe(resolve(OUTPUTS_DIR, 'test-md-basic.md'));
    expect(existsSync(outputPath)).toBe(true);

    const text = readFileSync(outputPath, 'utf-8');
    expect(text).toMatch(/^---\n/);
    expect(text).toContain('title: "Test Document"');
    expect(text).toContain('# Introduction');
    expect(text).toContain('This is the body.');
  });

  it('should include all metadata in front-matter', async () => {
    const outputPath = await buildMd({
      title: 'Full Metadata',
      author: 'Jane Doe',
      course: 'CS-101',
      date: '2026-01-15',
      fileName: 'test-md-full.md',
      content: 'Body content.',
    });

    const text = readFileSync(outputPath, 'utf-8');
    expect(text).toContain('title: "Full Metadata"');
    expect(text).toContain('author: "Jane Doe"');
    expect(text).toContain('course: "CS-101"');
    expect(text).toContain('date: "2026-01-15"');
  });

  it('should preserve markdown formatting in content', async () => {
    const content = `# Heading 1

## Heading 2

This is **bold** and *italic* text.

- List item 1
- List item 2

\`\`\`javascript
console.log('hello');
\`\`\``;

    const outputPath = await buildMd({
      title: 'Preserve Test',
      fileName: 'test-md-preserve.md',
      content,
    });

    const text = readFileSync(outputPath, 'utf-8');
    // Strip front-matter and check content is preserved
    const contentPart = text.split('---\n').slice(2).join('---\n').trimStart();
    expect(contentPart).toBe(content);
  });
});

describe('buildFrontMatter', () => {
  it('should build front-matter with title only', () => {
    const fm = buildFrontMatter({ title: 'My Title' });
    expect(fm).toBe('---\ntitle: "My Title"\n---\n\n');
  });

  it('should include all provided fields', () => {
    const fm = buildFrontMatter({
      title: 'My Title',
      author: 'Author Name',
      course: 'CS-101',
      date: '2026-01-15',
    });
    expect(fm).toContain('title: "My Title"');
    expect(fm).toContain('author: "Author Name"');
    expect(fm).toContain('course: "CS-101"');
    expect(fm).toContain('date: "2026-01-15"');
  });

  it('should omit undefined fields', () => {
    const fm = buildFrontMatter({ title: 'Only Title', author: undefined });
    expect(fm).not.toContain('author:');
    expect(fm).not.toContain('course:');
    expect(fm).not.toContain('date:');
  });

  it('should escape quotes in values', () => {
    const fm = buildFrontMatter({ title: 'Title with "quotes"' });
    expect(fm).toContain('title: "Title with \\"quotes\\""');
  });
});
