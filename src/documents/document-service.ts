import { mkdirSync, existsSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { OUTPUTS_DIR } from '../config.js';
import { buildDocx } from './docx-builder.js';
import { buildPdf } from './pdf-builder.js';
import { buildTxt } from './txt-builder.js';
import { buildMd } from './md-builder.js';
import { emitActivity } from '../web/activity.js';

export interface CreateDocumentRequest {
  title: string;
  author?: string;
  course?: string;
  date?: string;
  fileName: string;
  content: string;
  format: 'docx' | 'pdf' | 'txt' | 'md';
  // DOCX-specific options (passed through to existing builder)
  includePageNumbers?: boolean;
  includeHeader?: boolean;
  fontSize?: number;
  lineSpacing?: number;
}

export interface CreateDocumentResult {
  filePath: string;
  fileName: string;
  format: string;
  sizeBytes: number;
}

const SUPPORTED_FORMATS = ['docx', 'pdf', 'txt', 'md'] as const;

/**
 * Unified document creation facade.
 * Routes to the correct format-specific builder based on the `format` field.
 */
export async function createDocument(request: CreateDocumentRequest): Promise<CreateDocumentResult> {
  const { format, fileName } = request;

  // Validate format
  if (!SUPPORTED_FORMATS.includes(format as (typeof SUPPORTED_FORMATS)[number])) {
    throw new Error(
      `Unsupported document format: "${format}". Supported formats are: ${SUPPORTED_FORMATS.join(', ')}`,
    );
  }

  // Ensure output directory exists recursively
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }

  // Route to the correct builder
  let outputPath: string;

  switch (format) {
    case 'docx':
      outputPath = await buildDocx({
        title: request.title,
        author: request.author,
        course: request.course,
        date: request.date,
        fileName: request.fileName,
        content: request.content,
        includePageNumbers: request.includePageNumbers,
        includeHeader: request.includeHeader,
        fontSize: request.fontSize,
        lineSpacing: request.lineSpacing,
      });
      break;

    case 'pdf':
      outputPath = await buildPdf({
        title: request.title,
        author: request.author,
        course: request.course,
        date: request.date,
        fileName: request.fileName,
        content: request.content,
      });
      break;

    case 'txt':
      outputPath = await buildTxt({
        title: request.title,
        author: request.author,
        course: request.course,
        date: request.date,
        fileName: request.fileName,
        content: request.content,
      });
      break;

    case 'md':
      outputPath = await buildMd({
        title: request.title,
        author: request.author,
        course: request.course,
        date: request.date,
        fileName: request.fileName,
        content: request.content,
      });
      break;

    default:
      throw new Error(
        `Unsupported document format: "${format}". Supported formats are: ${SUPPORTED_FORMATS.join(', ')}`,
      );
  }

  // Resolve to absolute path
  const absolutePath = isAbsolute(outputPath) ? outputPath : resolve(outputPath);

  // Get file size
  const stats = statSync(absolutePath);

  const result: CreateDocumentResult = {
    filePath: absolutePath,
    fileName,
    format,
    sizeBytes: stats.size,
  };

  emitActivity('document-created', `Created ${format.toUpperCase()} document: ${fileName}`, {
    filePath: absolutePath,
    size: stats.size,
    format,
  });

  return result;
}
