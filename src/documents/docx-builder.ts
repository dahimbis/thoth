import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Footer,
  PageNumber,
  NumberFormat,
  Header,
} from 'docx';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { OUTPUTS_DIR } from '../config.js';
import { logger } from '../ui/logger.js';

export interface DocumentConfig {
  title: string;
  author?: string;
  course?: string;
  date?: string;
  fileName: string;
  content: string;
  includePageNumbers?: boolean;
  includeHeader?: boolean;
  fontSize?: number;
  lineSpacing?: number;
}

/**
 * Build a DOCX file from assignment content.
 * Handles headings, paragraphs, page numbers, and basic formatting.
 */
export async function buildDocx(config: DocumentConfig): Promise<string> {
  const {
    title,
    author,
    course,
    date,
    fileName,
    content,
    includePageNumbers = true,
    includeHeader = true,
    fontSize = 24, // half-points (24 = 12pt)
    lineSpacing = 360, // twips (360 = 1.5 line spacing, 480 = double)
  } = config;

  // Parse content into document sections
  const sections = parseContentToSections(content);

  // Build document children
  const children: Paragraph[] = [];

  // Title page / header
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 32 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );

  if (author) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: author, size: fontSize })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
    );
  }

  if (course) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: course, size: fontSize })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }),
    );
  }

  if (date) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: date, size: fontSize })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
    );
  }

  // Content sections
  for (const section of sections) {
    if (section.type === 'heading') {
      const level = section.level === 1 ? HeadingLevel.HEADING_1
        : section.level === 2 ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3;

      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.text, bold: true, size: fontSize + 4 })],
          heading: level,
          spacing: { before: 300, after: 200 },
        }),
      );
    } else {
      // Regular paragraph
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.text, size: fontSize })],
          spacing: { line: lineSpacing, after: 200 },
        }),
      );
    }
  }

  // Build footer with page numbers
  const footerConfig = includePageNumbers
    ? {
        default: new Footer({
          children: [
            new Paragraph({
              children: [new TextRun({ children: [PageNumber.CURRENT] })],
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      }
    : undefined;

  // Build header
  const headerConfig = includeHeader && (author || course)
    ? {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${author ?? ''}  - ${course ?? ''}`,
                  size: 18,
                  italics: true,
                }),
              ],
              alignment: AlignmentType.RIGHT,
            }),
          ],
        }),
      }
    : undefined;

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            pageNumbers: includePageNumbers
              ? { start: 1, formatType: NumberFormat.DECIMAL }
              : undefined,
          },
        },
        headers: headerConfig,
        footers: footerConfig,
        children,
      },
    ],
  });

  // Generate the file
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }

  const outputPath = resolve(OUTPUTS_DIR, fileName);
  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outputPath, buffer);

  logger.success(`DOCX created: ${outputPath} (${Math.round(buffer.length / 1024)}KB)`);
  return outputPath;
}

/**
 * Parse markdown-like content into structured sections.
 */
function parseContentToSections(
  content: string,
): Array<{ type: 'heading' | 'paragraph'; text: string; level: number }> {
  const lines = content.split('\n');
  const sections: Array<{ type: 'heading' | 'paragraph'; text: string; level: number }> = [];

  let currentParagraph = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for markdown headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      // Flush current paragraph
      if (currentParagraph.trim()) {
        sections.push({ type: 'paragraph', text: currentParagraph.trim(), level: 0 });
        currentParagraph = '';
      }
      sections.push({
        type: 'heading',
        text: headingMatch[2]!,
        level: headingMatch[1]!.length,
      });
      continue;
    }

    // Check for bold line (likely a heading)
    const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/);
    if (boldMatch && trimmed.length < 100) {
      if (currentParagraph.trim()) {
        sections.push({ type: 'paragraph', text: currentParagraph.trim(), level: 0 });
        currentParagraph = '';
      }
      sections.push({ type: 'heading', text: boldMatch[1]!, level: 2 });
      continue;
    }

    // Empty line = paragraph break
    if (trimmed === '') {
      if (currentParagraph.trim()) {
        sections.push({ type: 'paragraph', text: currentParagraph.trim(), level: 0 });
        currentParagraph = '';
      }
      continue;
    }

    // Regular text  - accumulate into current paragraph
    currentParagraph += (currentParagraph ? ' ' : '') + trimmed;
  }

  // Flush remaining
  if (currentParagraph.trim()) {
    sections.push({ type: 'paragraph', text: currentParagraph.trim(), level: 0 });
  }

  return sections;
}

/**
 * Generate a filename following a convention.
 * Pattern: LastName_CourseCode_AssignmentTitle.docx
 */
export function generateFileName(
  studentName: string | undefined,
  courseCode: string | undefined,
  assignmentTitle: string,
  extension: string = 'docx',
): string {
  const parts: string[] = [];

  if (studentName) {
    const lastName = studentName.split(/\s+/).pop() ?? studentName;
    parts.push(lastName);
  }

  if (courseCode) {
    parts.push(courseCode.replace(/\s+/g, ''));
  }

  // Clean assignment title
  const cleanTitle = assignmentTitle
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  parts.push(cleanTitle);

  return `${parts.join('_')}.${extension}`;
}
