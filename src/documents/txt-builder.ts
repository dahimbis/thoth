import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { OUTPUTS_DIR } from '../config.js';
import { logger } from '../ui/logger.js';

export interface TxtDocumentConfig {
  title: string;
  author?: string;
  course?: string;
  date?: string;
  fileName: string;
  content: string;
}

/**
 * Build a plain-text file from assignment content.
 * Strips markdown formatting (headings, bold, italic markers) and writes plain text.
 */
export async function buildTxt(config: TxtDocumentConfig): Promise<string> {
  const { title, author, course, date, fileName, content } = config;

  // Ensure output directory exists
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }

  const outputPath = resolve(OUTPUTS_DIR, fileName);

  // Build the plain-text document
  const parts: string[] = [];

  // Header block
  parts.push(title);
  if (author) parts.push(author);
  if (course) parts.push(course);
  if (date) parts.push(date);
  parts.push(''); // blank line after header

  // Strip markdown from content and append
  parts.push(stripMarkdownFormatting(content));

  const plainText = parts.join('\n');
  writeFileSync(outputPath, plainText, 'utf-8');

  const sizeKB = Math.round(Buffer.byteLength(plainText, 'utf-8') / 1024);
  logger.success(`TXT created: ${outputPath} (${sizeKB}KB)`);

  return outputPath;
}

/**
 * Strip markdown formatting from content, converting it to plain text.
 * - Headings (#, ##, ###) become plain text lines
 * - Bold (**text**) and italic (*text*) markers are removed
 * - Inline code backticks are removed
 * - Underscored bold/italic markers are removed
 */
export function stripMarkdownFormatting(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    let processed = line;

    // Strip heading markers (# Heading → Heading)
    processed = processed.replace(/^(#{1,6})\s+/, '');

    // Strip bold markers (**text** → text)
    processed = processed.replace(/\*\*(.+?)\*\*/g, '$1');

    // Strip italic markers (*text* → text)
    processed = processed.replace(/\*(.+?)\*/g, '$1');

    // Strip bold markers (__text__ → text)
    processed = processed.replace(/__(.+?)__/g, '$1');

    // Strip italic markers (_text_ → text)
    processed = processed.replace(/_(.+?)_/g, '$1');

    // Strip inline code backticks (`code` → code)
    processed = processed.replace(/`(.+?)`/g, '$1');

    result.push(processed);
  }

  return result.join('\n');
}
