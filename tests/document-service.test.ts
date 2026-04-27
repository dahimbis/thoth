import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDocument, CreateDocumentRequest } from '../src/documents/document-service.js';
import { existsSync, readFileSync, rmSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { OUTPUTS_DIR, setDemoMode } from '../src/config.js';

// ── Setup / Teardown ─────────────────────────────────

const TEST_FILES: string[] = [];

function trackFile(fileName: string) {
  TEST_FILES.push(fileName);
}

beforeAll(() => {
  setDemoMode(true);
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }
});

afterAll(() => {
  for (const file of TEST_FILES) {
    const path = resolve(OUTPUTS_DIR, file);
    if (existsSync(path)) rmSync(path);
  }
});

// ── Helpers ──────────────────────────────────────────

/** Generate a random alphanumeric string of given length */
function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?\n';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** Generate a random string that is NOT a supported format */
function randomUnsupportedFormat(): string {
  const supported = new Set(['docx', 'pdf', 'txt', 'md']);
  const candidates = ['html', 'rtf', 'odt', 'csv', 'json', 'xml', 'latex', 'epub', 'pptx', 'xlsx', 'doc', 'png', 'jpg', 'bmp', 'svg', 'yaml', 'toml', 'ini', 'log'];
  const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
  // Safety check  - should never be supported
  if (supported.has(pick)) return 'unsupported_format';
  return pick;
}

// ── Unit Tests ───────────────────────────────────────

describe('Document Service  - Unit Tests', () => {
  it('should create a TXT document and return correct result', async () => {
    const fileName = 'ds-unit-test.txt';
    trackFile(fileName);

    const result = await createDocument({
      title: 'Unit Test Doc',
      author: 'Tester',
      fileName,
      content: 'Hello, world!',
      format: 'txt',
    });

    expect(result.filePath).toBe(resolve(OUTPUTS_DIR, fileName));
    expect(result.fileName).toBe(fileName);
    expect(result.format).toBe('txt');
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(existsSync(result.filePath)).toBe(true);
  });

  it('should create an MD document and return correct result', async () => {
    const fileName = 'ds-unit-test.md';
    trackFile(fileName);

    const result = await createDocument({
      title: 'MD Unit Test',
      fileName,
      content: '# Heading\n\nParagraph text.',
      format: 'md',
    });

    expect(result.filePath).toBe(resolve(OUTPUTS_DIR, fileName));
    expect(result.format).toBe('md');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('should create a PDF document and return correct result', async () => {
    const fileName = 'ds-unit-test.pdf';
    trackFile(fileName);

    const result = await createDocument({
      title: 'PDF Unit Test',
      fileName,
      content: 'PDF content here.',
      format: 'pdf',
    });

    expect(isAbsolute(result.filePath)).toBe(true);
    expect(result.format).toBe('pdf');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('should create a DOCX document and return correct result', async () => {
    const fileName = 'ds-unit-test.docx';
    trackFile(fileName);

    const result = await createDocument({
      title: 'DOCX Unit Test',
      fileName,
      content: 'DOCX content here.',
      format: 'docx',
    });

    expect(isAbsolute(result.filePath)).toBe(true);
    expect(result.format).toBe('docx');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('should throw for unsupported format', async () => {
    await expect(
      createDocument({
        title: 'Bad Format',
        fileName: 'bad.html',
        content: 'content',
        format: 'html' as any,
      }),
    ).rejects.toThrow(/Unsupported document format.*Supported formats/);
  });

  it('should list supported formats in the error message', async () => {
    try {
      await createDocument({
        title: 'Bad',
        fileName: 'bad.xyz',
        content: 'x',
        format: 'xyz' as any,
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('docx');
      expect(err.message).toContain('pdf');
      expect(err.message).toContain('txt');
      expect(err.message).toContain('md');
    }
  });
});

// ── Property-Based Tests ─────────────────────────────

const PBT_ITERATIONS = 20;

describe('Document Service  - Property-Based Tests', () => {
  /**
   * **Validates: Requirements 1.3, 1.5**
   * Property 1: TXT document round-trip  - creating a TXT file and reading it back produces identical content.
   */
  describe('Property: TXT document round-trip', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`TXT round-trip iteration ${i + 1}`, async () => {
        const content = randomString(50 + Math.floor(Math.random() * 200));
        const fileName = `pbt-txt-rt-${i}.txt`;
        trackFile(fileName);

        const result = await createDocument({
          title: 'PBT TXT',
          fileName,
          content,
          format: 'txt',
        });

        const fileContent = readFileSync(result.filePath, 'utf-8');
        // The TXT builder prepends a header block (title + blank line), then the content.
        // The content portion should be present verbatim in the file.
        expect(fileContent).toContain(content);
      });
    }
  });

  /**
   * **Validates: Requirements 1.4, 1.5**
   * Property 2: MD document round-trip  - creating an MD file and reading back (stripping front-matter) preserves content.
   */
  describe('Property: MD document round-trip', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`MD round-trip iteration ${i + 1}`, async () => {
        const content = `# Heading ${i}\n\n${randomString(50 + Math.floor(Math.random() * 200))}`;
        const fileName = `pbt-md-rt-${i}.md`;
        trackFile(fileName);

        const result = await createDocument({
          title: `PBT MD ${i}`,
          fileName,
          content,
          format: 'md',
        });

        const fileContent = readFileSync(result.filePath, 'utf-8');
        // Strip YAML front-matter: everything between the first --- and second ---
        const parts = fileContent.split('---\n');
        // parts[0] is empty (before first ---), parts[1] is front-matter, parts[2+] is content
        const bodyContent = parts.slice(2).join('---\n').trimStart();
        expect(bodyContent).toBe(content);
      });
    }
  });

  /**
   * **Validates: Requirements 1.5**
   * Property 3: Document Service returns valid absolute paths with non-zero file size for all supported formats.
   */
  describe('Property: Valid absolute paths with non-zero size for all formats', () => {
    const formats: Array<'txt' | 'md' | 'pdf' | 'docx'> = ['txt', 'md', 'pdf', 'docx'];

    for (let i = 0; i < PBT_ITERATIONS; i++) {
      const format = formats[i % formats.length]!;
      it(`absolute path + non-zero size: ${format} iteration ${i + 1}`, async () => {
        const content = randomString(30 + Math.floor(Math.random() * 100));
        const fileName = `pbt-abs-${i}.${format}`;
        trackFile(fileName);

        const result = await createDocument({
          title: `PBT Abs ${i}`,
          author: 'Test Author',
          fileName,
          content,
          format,
        });

        // Path must be absolute
        expect(isAbsolute(result.filePath)).toBe(true);
        // File must exist
        expect(existsSync(result.filePath)).toBe(true);
        // Size must be non-zero
        expect(result.sizeBytes).toBeGreaterThan(0);
        // Stat size must match returned size
        const stat = statSync(result.filePath);
        expect(result.sizeBytes).toBe(stat.size);
      });
    }
  });

  /**
   * **Validates: Requirements 1.6**
   * Property 4: Unsupported format strings are rejected with a descriptive error.
   */
  describe('Property: Unsupported formats are rejected', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`unsupported format rejection iteration ${i + 1}`, async () => {
        const badFormat = randomUnsupportedFormat();

        await expect(
          createDocument({
            title: 'Should Fail',
            fileName: `pbt-bad-${i}.${badFormat}`,
            content: 'content',
            format: badFormat as any,
          }),
        ).rejects.toThrow(/Unsupported document format/);

        // Error should list supported formats
        try {
          await createDocument({
            title: 'Should Fail',
            fileName: `pbt-bad-check-${i}.${badFormat}`,
            content: 'content',
            format: badFormat as any,
          });
        } catch (err: any) {
          expect(err.message).toContain('Supported formats');
          expect(err.message).toContain('docx');
          expect(err.message).toContain('pdf');
          expect(err.message).toContain('txt');
          expect(err.message).toContain('md');
        }
      });
    }
  });
});
