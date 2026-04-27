import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { OUTPUTS_DIR } from '../config.js';
import { logger } from '../ui/logger.js';

export interface MdDocumentConfig {
  title: string;
  author?: string;
  course?: string;
  date?: string;
  fileName: string;
  content: string;
}

/**
 * Build a Markdown file from assignment content.
 * Preserves all markdown formatting and adds a YAML front-matter block
 * with title, author, course, and date metadata.
 */
export async function buildMd(config: MdDocumentConfig): Promise<string> {
  const { title, author, course, date, fileName, content } = config;

  // Ensure output directory exists
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }

  const outputPath = resolve(OUTPUTS_DIR, fileName);

  // Build YAML front-matter
  const frontMatter = buildFrontMatter({ title, author, course, date });

  // Combine front-matter and content
  const markdown = frontMatter + content;

  writeFileSync(outputPath, markdown, 'utf-8');

  const sizeKB = Math.round(Buffer.byteLength(markdown, 'utf-8') / 1024);
  logger.success(`MD created: ${outputPath} (${sizeKB}KB)`);

  return outputPath;
}

/**
 * Build a YAML front-matter block from metadata fields.
 * Only includes fields that have values.
 */
export function buildFrontMatter(meta: {
  title: string;
  author?: string;
  course?: string;
  date?: string;
}): string {
  const lines: string[] = ['---'];

  lines.push(`title: "${escapeYamlString(meta.title)}"`);

  if (meta.author) {
    lines.push(`author: "${escapeYamlString(meta.author)}"`);
  }
  if (meta.course) {
    lines.push(`course: "${escapeYamlString(meta.course)}"`);
  }
  if (meta.date) {
    lines.push(`date: "${escapeYamlString(meta.date)}"`);
  }

  lines.push('---');
  lines.push(''); // blank line after front-matter
  lines.push(''); // second empty string to produce \n\n after ---

  return lines.join('\n');
}

/**
 * Escape special characters in YAML string values.
 */
function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
