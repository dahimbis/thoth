/**
 * File Manager  - local filesystem operations with security boundary.
 *
 * All paths are resolved against PROJECT_ROOT and rejected if they escape it.
 * Binary detection for reads: checks first 8KB for null bytes.
 */

import { resolve, relative } from 'path';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs';
import { PROJECT_ROOT } from '../config.js';
import { emitActivity } from '../web/activity.js';

// ── Interfaces ───────────────────────────────────────

export interface FileOperation {
  operation: 'mkdir' | 'copy' | 'move' | 'delete' | 'list' | 'read';
  path: string;           // Target path (relative to project root or absolute within root)
  destination?: string;   // For copy/move operations
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAt: string;     // ISO 8601
}

export interface FileOperationResult {
  success: boolean;
  path?: string;
  entries?: FileEntry[];   // For list operations
  content?: string;        // For read operations
  error?: string;
}

// ── Path Security ────────────────────────────────────

/**
 * Resolve a user-supplied path against PROJECT_ROOT and verify it stays within bounds.
 * Throws if the resolved path escapes the project root.
 */
export function resolveSafePath(inputPath: string): string {
  const resolved = resolve(PROJECT_ROOT, inputPath);
  // Ensure the resolved path is within PROJECT_ROOT.
  // We append a path separator to PROJECT_ROOT to avoid prefix collisions
  // (e.g., /project-root-extra should not match /project-root).
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(PROJECT_ROOT + '/') && !resolved.startsWith(PROJECT_ROOT + '\\')) {
    throw new Error(
      `Security error: path "${inputPath}" resolves to "${resolved}" which is outside the project root "${PROJECT_ROOT}"`,
    );
  }
  return resolved;
}

// ── Operations ───────────────────────────────────────

/**
 * Execute a file operation and return the result.
 */
export async function executeFileOperation(op: FileOperation): Promise<FileOperationResult> {
  try {
    switch (op.operation) {
      case 'mkdir':
        return doMkdir(op.path);
      case 'copy':
        return doCopy(op.path, op.destination);
      case 'move':
        return doMove(op.path, op.destination);
      case 'delete':
        return doDelete(op.path);
      case 'list':
        return doList(op.path);
      case 'read':
        return doRead(op.path);
      default:
        return { success: false, error: `Unknown operation: ${(op as any).operation}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) };
  }
}

// ── mkdir ────────────────────────────────────────────

function doMkdir(targetPath: string): FileOperationResult {
  const resolved = resolveSafePath(targetPath);
  mkdirSync(resolved, { recursive: true });
  emitActivity('directory-created', `Created directory: ${resolved}`, { path: resolved });
  return { success: true, path: resolved };
}

// ── copy ─────────────────────────────────────────────

function doCopy(sourcePath: string, destination?: string): FileOperationResult {
  if (!destination) {
    return { success: false, error: 'Copy operation requires a destination path' };
  }
  const resolvedSrc = resolveSafePath(sourcePath);
  const resolvedDst = resolveSafePath(destination);

  if (!existsSync(resolvedSrc)) {
    return { success: false, error: `Source path does not exist: ${resolvedSrc}` };
  }

  // Ensure destination directory exists
  const dstDir = resolve(resolvedDst, '..');
  mkdirSync(dstDir, { recursive: true });

  copyFileSync(resolvedSrc, resolvedDst);
  emitActivity('file-copied', `Copied file: ${resolvedSrc} → ${resolvedDst}`, {
    source: resolvedSrc,
    destination: resolvedDst,
  });
  return { success: true, path: resolvedDst };
}

// ── move ─────────────────────────────────────────────

function doMove(sourcePath: string, destination?: string): FileOperationResult {
  if (!destination) {
    return { success: false, error: 'Move operation requires a destination path' };
  }
  const resolvedSrc = resolveSafePath(sourcePath);
  const resolvedDst = resolveSafePath(destination);

  if (!existsSync(resolvedSrc)) {
    return { success: false, error: `Source path does not exist: ${resolvedSrc}` };
  }

  // Ensure destination directory exists
  const dstDir = resolve(resolvedDst, '..');
  mkdirSync(dstDir, { recursive: true });

  renameSync(resolvedSrc, resolvedDst);

  // Verify source is removed
  if (existsSync(resolvedSrc)) {
    return { success: false, error: `Move completed but source still exists: ${resolvedSrc}` };
  }

  emitActivity('file-moved', `Moved file: ${resolvedSrc} → ${resolvedDst}`, {
    source: resolvedSrc,
    destination: resolvedDst,
  });
  return { success: true, path: resolvedDst };
}

// ── delete ───────────────────────────────────────────

function doDelete(targetPath: string): FileOperationResult {
  const resolved = resolveSafePath(targetPath);

  if (!existsSync(resolved)) {
    return { success: false, error: `Path does not exist: ${resolved}` };
  }

  rmSync(resolved, { recursive: true });
  emitActivity('file-deleted', `Deleted: ${resolved}`, { path: resolved });
  return { success: true, path: resolved };
}

// ── list ─────────────────────────────────────────────

function doList(targetPath: string): FileOperationResult {
  const resolved = resolveSafePath(targetPath);

  if (!existsSync(resolved)) {
    return { success: false, error: `Path does not exist: ${resolved}` };
  }

  const entries: FileEntry[] = readdirSync(resolved).map((name) => {
    const fullPath = resolve(resolved, name);
    const stat = statSync(fullPath);
    return {
      name,
      type: stat.isDirectory() ? 'directory' as const : 'file' as const,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  });

  return { success: true, path: resolved, entries };
}

// ── read ─────────────────────────────────────────────

/** Size of the chunk to inspect for binary detection */
const BINARY_CHECK_SIZE = 8192; // 8KB

/**
 * Check if a buffer contains null bytes, indicating binary content.
 */
function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, BINARY_CHECK_SIZE);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0x00) return true;
  }
  return false;
}

function doRead(targetPath: string): FileOperationResult {
  const resolved = resolveSafePath(targetPath);

  if (!existsSync(resolved)) {
    return { success: false, error: `Path does not exist: ${resolved}` };
  }

  const buffer = readFileSync(resolved);

  if (isBinaryBuffer(buffer)) {
    // Binary file  - return base64
    emitActivity('file-read', `Read binary file: ${resolved}`, { path: resolved, encoding: 'base64' });
    return { success: true, path: resolved, content: buffer.toString('base64') };
  }

  // Text file  - return UTF-8
  emitActivity('file-read', `Read text file: ${resolved}`, { path: resolved, encoding: 'utf-8' });
  return { success: true, path: resolved, content: buffer.toString('utf-8') };
}
