import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  executeFileOperation,
  resolveSafePath,
  FileOperation,
  FileOperationResult,
} from '../src/computer/file-manager.js';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync,
} from 'fs';
import { resolve, join } from 'path';
import { PROJECT_ROOT, setDemoMode } from '../src/config.js';

// ── Setup / Teardown ─────────────────────────────────

const TEST_DIR = resolve(PROJECT_ROOT, 'test-file-manager-sandbox');

beforeAll(() => {
  setDemoMode(true);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ── Helpers ──────────────────────────────────────────

/** Generate a random alphanumeric string */
function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?\n\t';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** Generate a random safe filename */
function randomFileName(prefix: string, ext: string): string {
  const id = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${id}.${ext}`;
}

/** Create a file in the sandbox with given content */
function createTestFile(name: string, content: string | Buffer): string {
  const filePath = resolve(TEST_DIR, name);
  const dir = resolve(filePath, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

/** Get a relative path from PROJECT_ROOT to a sandbox file */
function sandboxRelative(name: string): string {
  return join('test-file-manager-sandbox', name);
}

// ── Unit Tests ───────────────────────────────────────

describe('File Manager  - Unit Tests', () => {
  describe('Path Security', () => {
    it('should resolve a relative path within project root', () => {
      const resolved = resolveSafePath('test-file-manager-sandbox/foo.txt');
      expect(resolved).toBe(resolve(PROJECT_ROOT, 'test-file-manager-sandbox/foo.txt'));
    });

    it('should reject paths that traverse outside project root', () => {
      expect(() => resolveSafePath('../../etc/passwd')).toThrow(/Security error/);
    });

    it('should reject absolute paths outside project root', () => {
      expect(() => resolveSafePath('/tmp/evil')).toThrow(/Security error/);
    });

    it('should allow PROJECT_ROOT itself', () => {
      const resolved = resolveSafePath('.');
      expect(resolved).toBe(PROJECT_ROOT);
    });
  });

  describe('mkdir', () => {
    it('should create a directory recursively', async () => {
      const dirName = `mkdir-test-${Date.now()}`;
      const result = await executeFileOperation({
        operation: 'mkdir',
        path: sandboxRelative(`${dirName}/nested/deep`),
      });

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(existsSync(result.path!)).toBe(true);

      // Cleanup
      rmSync(resolve(TEST_DIR, dirName), { recursive: true, force: true });
    });
  });

  describe('copy', () => {
    it('should copy a file and preserve content', async () => {
      const srcName = randomFileName('copy-src', 'txt');
      const dstName = randomFileName('copy-dst', 'txt');
      const content = 'Hello, copy test!';
      createTestFile(srcName, content);

      const result = await executeFileOperation({
        operation: 'copy',
        path: sandboxRelative(srcName),
        destination: sandboxRelative(dstName),
      });

      expect(result.success).toBe(true);
      expect(existsSync(resolve(TEST_DIR, srcName))).toBe(true); // source still exists
      expect(readFileSync(resolve(TEST_DIR, dstName), 'utf-8')).toBe(content);
    });

    it('should return error when source does not exist', async () => {
      const result = await executeFileOperation({
        operation: 'copy',
        path: sandboxRelative('nonexistent.txt'),
        destination: sandboxRelative('dst.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
      expect(result.error).toContain('nonexistent.txt');
    });

    it('should return error when destination is missing', async () => {
      const result = await executeFileOperation({
        operation: 'copy',
        path: sandboxRelative('some.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('destination');
    });
  });

  describe('move', () => {
    it('should move a file and remove source', async () => {
      const srcName = randomFileName('move-src', 'txt');
      const dstName = randomFileName('move-dst', 'txt');
      const content = 'Hello, move test!';
      createTestFile(srcName, content);

      const result = await executeFileOperation({
        operation: 'move',
        path: sandboxRelative(srcName),
        destination: sandboxRelative(dstName),
      });

      expect(result.success).toBe(true);
      expect(existsSync(resolve(TEST_DIR, srcName))).toBe(false); // source removed
      expect(readFileSync(resolve(TEST_DIR, dstName), 'utf-8')).toBe(content);
    });

    it('should return error when source does not exist', async () => {
      const result = await executeFileOperation({
        operation: 'move',
        path: sandboxRelative('nonexistent-move.txt'),
        destination: sandboxRelative('dst-move.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });
  });

  describe('delete', () => {
    it('should delete a file', async () => {
      const name = randomFileName('delete-test', 'txt');
      createTestFile(name, 'delete me');

      const result = await executeFileOperation({
        operation: 'delete',
        path: sandboxRelative(name),
      });

      expect(result.success).toBe(true);
      expect(existsSync(resolve(TEST_DIR, name))).toBe(false);
    });

    it('should return error when path does not exist', async () => {
      const result = await executeFileOperation({
        operation: 'delete',
        path: sandboxRelative('nonexistent-delete.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });
  });

  describe('list', () => {
    it('should list directory contents with correct types', async () => {
      const listDir = `list-test-${Date.now()}`;
      mkdirSync(resolve(TEST_DIR, listDir, 'subdir'), { recursive: true });
      writeFileSync(resolve(TEST_DIR, listDir, 'file1.txt'), 'content1');
      writeFileSync(resolve(TEST_DIR, listDir, 'file2.txt'), 'content2');

      const result = await executeFileOperation({
        operation: 'list',
        path: sandboxRelative(listDir),
      });

      expect(result.success).toBe(true);
      expect(result.entries).toBeDefined();
      expect(result.entries!.length).toBe(3);

      const names = result.entries!.map((e) => e.name).sort();
      expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir']);

      const subdir = result.entries!.find((e) => e.name === 'subdir');
      expect(subdir!.type).toBe('directory');

      const file1 = result.entries!.find((e) => e.name === 'file1.txt');
      expect(file1!.type).toBe('file');
      expect(file1!.sizeBytes).toBeGreaterThan(0);
      expect(file1!.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601

      // Cleanup
      rmSync(resolve(TEST_DIR, listDir), { recursive: true, force: true });
    });

    it('should return error for nonexistent directory', async () => {
      const result = await executeFileOperation({
        operation: 'list',
        path: sandboxRelative('nonexistent-dir'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });
  });

  describe('read', () => {
    it('should read a text file as UTF-8', async () => {
      const name = randomFileName('read-text', 'txt');
      const content = 'Hello, read test! 🎉';
      createTestFile(name, content);

      const result = await executeFileOperation({
        operation: 'read',
        path: sandboxRelative(name),
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe(content);
    });

    it('should read a binary file as base64', async () => {
      const name = randomFileName('read-binary', 'bin');
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
      createTestFile(name, binaryContent);

      const result = await executeFileOperation({
        operation: 'read',
        path: sandboxRelative(name),
      });

      expect(result.success).toBe(true);
      // Should be base64 encoded
      const decoded = Buffer.from(result.content!, 'base64');
      expect(decoded.equals(binaryContent)).toBe(true);
    });

    it('should return error for nonexistent file', async () => {
      const result = await executeFileOperation({
        operation: 'read',
        path: sandboxRelative('nonexistent-read.txt'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });
  });

  describe('Security  - path traversal via operations', () => {
    it('should reject mkdir outside project root', async () => {
      const result = await executeFileOperation({
        operation: 'mkdir',
        path: '../../outside-root',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Security error');
    });

    it('should reject copy with destination outside project root', async () => {
      const srcName = randomFileName('sec-copy', 'txt');
      createTestFile(srcName, 'data');

      const result = await executeFileOperation({
        operation: 'copy',
        path: sandboxRelative(srcName),
        destination: '/tmp/evil-copy.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Security error');
    });
  });
});

// ── Property-Based Tests ─────────────────────────────

const PBT_ITERATIONS = 20;

describe('File Manager  - Property-Based Tests', () => {
  /**
   * **Validates: Requirements 2.2**
   * Property 5: File copy preserves content  - source and destination have identical bytes, source still exists.
   */
  describe('Property: File copy preserves content', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`copy preserves content iteration ${i + 1}`, async () => {
        const content = randomString(10 + Math.floor(Math.random() * 500));
        const srcName = `pbt-copy-src-${i}-${Date.now()}.txt`;
        const dstName = `pbt-copy-dst-${i}-${Date.now()}.txt`;
        createTestFile(srcName, content);

        const result = await executeFileOperation({
          operation: 'copy',
          path: sandboxRelative(srcName),
          destination: sandboxRelative(dstName),
        });

        expect(result.success).toBe(true);

        // Source still exists
        expect(existsSync(resolve(TEST_DIR, srcName))).toBe(true);

        // Destination has identical content
        const srcBytes = readFileSync(resolve(TEST_DIR, srcName));
        const dstBytes = readFileSync(resolve(TEST_DIR, dstName));
        expect(srcBytes.equals(dstBytes)).toBe(true);
      });
    }
  });

  /**
   * **Validates: Requirements 2.3**
   * Property 6: File move preserves content and removes source.
   */
  describe('Property: File move preserves content and removes source', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`move preserves content iteration ${i + 1}`, async () => {
        const content = randomString(10 + Math.floor(Math.random() * 500));
        const srcName = `pbt-move-src-${i}-${Date.now()}.txt`;
        const dstName = `pbt-move-dst-${i}-${Date.now()}.txt`;
        createTestFile(srcName, content);

        // Record original content
        const originalBytes = readFileSync(resolve(TEST_DIR, srcName));

        const result = await executeFileOperation({
          operation: 'move',
          path: sandboxRelative(srcName),
          destination: sandboxRelative(dstName),
        });

        expect(result.success).toBe(true);

        // Source no longer exists
        expect(existsSync(resolve(TEST_DIR, srcName))).toBe(false);

        // Destination has identical content
        const dstBytes = readFileSync(resolve(TEST_DIR, dstName));
        expect(originalBytes.equals(dstBytes)).toBe(true);
      });
    }
  });

  /**
   * **Validates: Requirements 2.7**
   * Property 7: Path security rejects traversal outside PROJECT_ROOT.
   */
  describe('Property: Path security rejects traversal outside PROJECT_ROOT', () => {
    const traversalPatterns = [
      '../../../etc/passwd',
      '../../../../tmp/evil',
      '../../../../../../../root/.ssh/id_rsa',
      '/etc/shadow',
      '/tmp/outside',
      '/var/log/syslog',
      '..\\..\\..\\Windows\\System32',
      'test/../../../../../../outside',
      '../'.repeat(20) + 'etc/passwd',
      '/absolute/path/outside/root',
    ];

    // Generate additional random traversal patterns
    for (let i = 0; i < PBT_ITERATIONS - traversalPatterns.length; i++) {
      const depth = 3 + Math.floor(Math.random() * 10);
      const suffix = randomString(5).replace(/[^a-zA-Z0-9]/g, '') || 'file';
      traversalPatterns.push('../'.repeat(depth) + suffix);
    }

    for (let i = 0; i < PBT_ITERATIONS; i++) {
      const pattern = traversalPatterns[i % traversalPatterns.length]!;
      it(`rejects traversal pattern iteration ${i + 1}: "${pattern.slice(0, 40)}..."`, async () => {
        // Test with multiple operation types
        const operations: FileOperation['operation'][] = ['mkdir', 'delete', 'list', 'read'];
        const op = operations[i % operations.length]!;

        const result = await executeFileOperation({
          operation: op,
          path: pattern,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Security error');
      });
    }
  });

  /**
   * **Validates: Requirements 2.5**
   * Property 8: Directory listing accuracy  - entry count and types match the actual directory contents.
   */
  describe('Property: Directory listing accuracy', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`listing accuracy iteration ${i + 1}`, async () => {
        const dirName = `pbt-list-${i}-${Date.now()}`;
        const dirPath = resolve(TEST_DIR, dirName);
        mkdirSync(dirPath, { recursive: true });

        // Create a random number of files and subdirectories
        const numFiles = Math.floor(Math.random() * 5);
        const numDirs = Math.floor(Math.random() * 3);
        const expectedEntries: { name: string; type: 'file' | 'directory' }[] = [];

        for (let f = 0; f < numFiles; f++) {
          const name = `file-${f}.txt`;
          writeFileSync(resolve(dirPath, name), randomString(10 + Math.floor(Math.random() * 50)));
          expectedEntries.push({ name, type: 'file' });
        }

        for (let d = 0; d < numDirs; d++) {
          const name = `dir-${d}`;
          mkdirSync(resolve(dirPath, name), { recursive: true });
          expectedEntries.push({ name, type: 'directory' });
        }

        const result = await executeFileOperation({
          operation: 'list',
          path: sandboxRelative(dirName),
        });

        expect(result.success).toBe(true);
        expect(result.entries).toBeDefined();

        // Entry count matches
        expect(result.entries!.length).toBe(expectedEntries.length);

        // Each expected entry is present with correct type
        for (const expected of expectedEntries) {
          const found = result.entries!.find((e) => e.name === expected.name);
          expect(found).toBeDefined();
          expect(found!.type).toBe(expected.type);
          // modifiedAt should be a valid ISO 8601 string
          expect(new Date(found!.modifiedAt).toISOString()).toBe(found!.modifiedAt);
        }

        // Cleanup
        rmSync(dirPath, { recursive: true, force: true });
      });
    }
  });

  /**
   * **Validates: Requirements 2.9**
   * Property 12: File read round-trip for text files  - writing and reading back produces identical content.
   */
  describe('Property: File read round-trip for text files', () => {
    for (let i = 0; i < PBT_ITERATIONS; i++) {
      it(`read round-trip iteration ${i + 1}`, async () => {
        const content = randomString(10 + Math.floor(Math.random() * 500));
        const name = `pbt-read-rt-${i}-${Date.now()}.txt`;
        createTestFile(name, content);

        const result = await executeFileOperation({
          operation: 'read',
          path: sandboxRelative(name),
        });

        expect(result.success).toBe(true);
        expect(result.content).toBe(content);
      });
    }
  });
});
