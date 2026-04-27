import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { OUTPUTS_DIR } from '../config.js';
import { logger } from '../ui/logger.js';

export interface PdfDocumentConfig {
  title: string;
  author?: string;
  course?: string;
  date?: string;
  fileName: string;
  content: string;
}

/**
 * Build a PDF file from assignment content.
 * Handles headings, paragraphs, and basic markdown-like formatting using pdfkit.
 */
export async function buildPdf(config: PdfDocumentConfig): Promise<string> {
  const { title, author, course, date, fileName, content } = config;

  // Ensure output directory exists
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }

  const outputPath = resolve(OUTPUTS_DIR, fileName);

  return new Promise<string>((resolvePromise, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: title,
        Author: author ?? '',
      },
    });

    const stream = createWriteStream(outputPath);
    doc.pipe(stream);

    // ── Title block ──────────────────────────────────
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text(title, { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica');

    if (author) {
      doc.text(author, { align: 'center' });
    }
    if (course) {
      doc.text(course, { align: 'center' });
    }
    if (date) {
      doc.text(date, { align: 'center' });
    }

    doc.moveDown(1.5);

    // ── Content ──────────────────────────────────────
    const sections = parseContentToSections(content);

    for (const section of sections) {
      if (section.type === 'heading') {
        const fontSize = section.level === 1 ? 16 : section.level === 2 ? 14 : 13;
        doc.moveDown(0.5);
        doc.fontSize(fontSize).font('Helvetica-Bold');
        doc.text(section.text);
        doc.moveDown(0.3);
        doc.fontSize(12).font('Helvetica');
      } else {
        doc.fontSize(12).font('Helvetica');
        doc.text(section.text, { lineGap: 4 });
        doc.moveDown(0.5);
      }
    }

    doc.end();

    stream.on('finish', () => {
      const { size } = statSync(outputPath);
      logger.success(`PDF created: ${outputPath} (${Math.round(size / 1024)}KB)`);
      resolvePromise(outputPath);
    });

    stream.on('error', (err: Error) => {
      reject(new Error(`Failed to write PDF: ${err.message}`));
    });
  });
}

/**
 * Parse markdown-like content into structured sections.
 * Strips inline markdown formatting (bold, italic markers).
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
      if (currentParagraph.trim()) {
        sections.push({ type: 'paragraph', text: stripMarkdown(currentParagraph.trim()), level: 0 });
        currentParagraph = '';
      }
      sections.push({
        type: 'heading',
        text: stripMarkdown(headingMatch[2]!),
        level: headingMatch[1]!.length,
      });
      continue;
    }

    // Check for bold line (likely a heading)
    const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/);
    if (boldMatch && trimmed.length < 100) {
      if (currentParagraph.trim()) {
        sections.push({ type: 'paragraph', text: stripMarkdown(currentParagraph.trim()), level: 0 });
        currentParagraph = '';
      }
      sections.push({ type: 'heading', text: stripMarkdown(boldMatch[1]!), level: 2 });
      continue;
    }

    // Empty line = paragraph break
    if (trimmed === '') {
      if (currentParagraph.trim()) {
        sections.push({ type: 'paragraph', text: stripMarkdown(currentParagraph.trim()), level: 0 });
        currentParagraph = '';
      }
      continue;
    }

    // Regular text  - accumulate into current paragraph
    currentParagraph += (currentParagraph ? ' ' : '') + trimmed;
  }

  // Flush remaining
  if (currentParagraph.trim()) {
    sections.push({ type: 'paragraph', text: stripMarkdown(currentParagraph.trim()), level: 0 });
  }

  return sections;
}

/**
 * Strip inline markdown formatting markers.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // bold
    .replace(/\*(.+?)\*/g, '$1')        // italic
    .replace(/__(.+?)__/g, '$1')        // bold (underscores)
    .replace(/_(.+?)_/g, '$1')          // italic (underscores)
    .replace(/`(.+?)`/g, '$1');         // inline code
}
