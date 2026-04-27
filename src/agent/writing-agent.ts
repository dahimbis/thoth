import { generateText } from 'ai';
import { getWritingModel } from './providers.js';
import { conductResearch, formatCitations, type ResearchResult } from './research-agent.js';
import { logger } from '../ui/logger.js';

/**
 * Writing Agent  - generates assignment content through a multi-phase pipeline:
 *
 * Phase 1: Research (if external sources required)
 * Phase 2: Outline generation (JSON structured outline)
 * Phase 3: Full draft generation
 * Phase 4: Self-critique + revision against rubric
 */

export interface WritingInput {
  instructions: string;
  rubric: string | null;
  wordLimit: string | null;
  citationStyle: string | null;
  fileFormat: string | null;
  courseContext?: string;
  additionalNotes?: string;
}

export interface WritingOutput {
  outline: string;
  draft: string;
  finalVersion: string;
  wordCount: number;
  rubricCheck: RubricCheckResult[];
  citations: string;
  researchSummary: string;
}

export interface RubricCheckResult {
  criterion: string;
  passed: boolean;
  notes: string;
}

/**
 * Run the full writing pipeline.
 */
export async function generateAssignmentContent(input: WritingInput): Promise<WritingOutput> {
  logger.info('Starting writing pipeline');

  // Phase 1: Research
  let researchResults: ResearchResult[] = [];
  let researchSummary = '';
  let citations = '';

  const needsResearch = detectResearchNeed(input.instructions);
  if (needsResearch) {
    logger.info('Phase 1: Conducting research...');
    researchResults = await conductResearch(input.instructions, input.citationStyle ?? undefined);
    researchSummary = researchResults.map((r) => r.summary).join('\n\n');
    if (input.citationStyle) {
      citations = formatCitations(researchResults, input.citationStyle);
    }
  } else {
    logger.info('Phase 1: Skipped (no external sources required)');
  }

  // Phase 2: Outline
  logger.info('Phase 2: Generating outline...');
  const outline = await generateOutline(input, researchSummary);

  // Phase 3: Draft
  logger.info('Phase 3: Generating draft...');
  const draft = await generateDraft(input, outline, researchSummary, citations);

  // Phase 4: Self-critique + revision
  logger.info('Phase 4: Self-critique and revision...');
  const { finalVersion, rubricCheck } = await selfCritiqueAndRevise(input, draft);

  const wordCount = finalVersion.split(/\s+/).length;

  // Check word limit compliance
  if (input.wordLimit) {
    const limitMatch = input.wordLimit.match(/(\d+)/);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1]!, 10);
      if (wordCount > limit * 1.1) {
        // Over by more than 10%
        logger.warn(`Word count ${wordCount} exceeds limit ${limit}. Compressing...`);
        const compressed = await compressToWordLimit(finalVersion, limit, input.rubric);
        return {
          outline,
          draft,
          finalVersion: compressed,
          wordCount: compressed.split(/\s+/).length,
          rubricCheck,
          citations,
          researchSummary,
        };
      }
    }
  }

  logger.success(`Writing pipeline complete. ${wordCount} words.`);

  return {
    outline,
    draft,
    finalVersion,
    wordCount,
    rubricCheck,
    citations,
    researchSummary,
  };
}

/**
 * Detect if the assignment requires external research/sources.
 */
function detectResearchNeed(instructions: string): boolean {
  const lower = instructions.toLowerCase();
  const indicators = [
    'cite', 'citation', 'source', 'reference', 'research',
    'evidence', 'scholarly', 'peer-reviewed', 'journal',
    'bibliography', 'works cited', 'find', 'analyze',
    'current events', 'recent', 'studies show',
  ];
  return indicators.some((i) => lower.includes(i));
}

/**
 * Phase 2: Generate a structured outline covering all rubric criteria.
 */
async function generateOutline(input: WritingInput, researchSummary: string): Promise<string> {
  const { text } = await generateText({
    model: getWritingModel(),
    system: `Generate a structured outline for an academic assignment. The outline must:
1. Cover ALL rubric criteria if a rubric is provided
2. Be organized with clear sections and subsections
3. Include key points to address in each section
4. Identify where citations/evidence should be used

Return the outline as structured text with section numbers and bullet points.`,
    prompt: `ASSIGNMENT INSTRUCTIONS:
${input.instructions}

${input.rubric ? `RUBRIC:\n${input.rubric}` : 'No rubric provided.'}

${researchSummary ? `RESEARCH FINDINGS:\n${researchSummary.substring(0, 3000)}` : ''}

${input.wordLimit ? `WORD LIMIT: ${input.wordLimit}` : ''}
${input.citationStyle ? `CITATION STYLE: ${input.citationStyle}` : ''}
${input.courseContext ? `COURSE CONTEXT: ${input.courseContext}` : ''}`,
    maxOutputTokens: 2000,
  });

  return text;
}

/**
 * Phase 3: Generate the complete draft using the outline.
 */
async function generateDraft(
  input: WritingInput,
  outline: string,
  researchSummary: string,
  citations: string,
): Promise<string> {
  const { text } = await generateText({
    model: getWritingModel(),
    system: `Write the complete assignment draft following the provided outline. Requirements:
1. Use clear academic writing with proper headings
2. Be thorough and meet all rubric criteria
3. Include in-text citations where evidence is used
4. Maintain a logical flow between sections
5. Write in your own words  - do not copy sources verbatim
${input.wordLimit ? `6. Target word count: ${input.wordLimit}` : ''}
${input.citationStyle ? `7. Use ${input.citationStyle} citation format` : ''}

Write the complete assignment text. Do not include meta-commentary about the assignment itself.`,
    prompt: `OUTLINE:
${outline}

ASSIGNMENT INSTRUCTIONS:
${input.instructions}

${researchSummary ? `RESEARCH WITH CITATIONS:\n${researchSummary.substring(0, 4000)}` : ''}

${citations ? `FORMATTED REFERENCES:\n${citations}` : ''}`,
    maxOutputTokens: 8000,
  });

  return text;
}

/**
 * Phase 4: Self-critique against rubric, then revise.
 */
async function selfCritiqueAndRevise(
  input: WritingInput,
  draft: string,
): Promise<{ finalVersion: string; rubricCheck: RubricCheckResult[] }> {
  const { text } = await generateText({
    model: getWritingModel(),
    system: `You are a rigorous academic reviewer. You must:

1. Grade this draft against the rubric criteria (if provided) or against general academic standards
2. List EVERY gap, weakness, or missing element
3. Then rewrite the draft to fix ALL identified issues
4. Return your response in this exact format:

=== RUBRIC CHECK ===
[For each criterion, write: CRITERION | PASS or FAIL | brief note]

=== REVISED VERSION ===
[The complete revised text  - this is the final submission]`,
    prompt: `DRAFT:
${draft}

ASSIGNMENT INSTRUCTIONS:
${input.instructions}

${input.rubric ? `RUBRIC:\n${input.rubric}` : 'No rubric provided  - evaluate against general academic quality standards.'}

${input.wordLimit ? `WORD LIMIT: ${input.wordLimit}` : ''}`,
    maxOutputTokens: 10000,
  });

  // Parse rubric check
  const rubricCheck: RubricCheckResult[] = [];
  const checkMatch = text.match(/=== RUBRIC CHECK ===([\s\S]*?)(?:=== REVISED VERSION ===|$)/);
  if (checkMatch?.[1]) {
    const lines = checkMatch[1].trim().split('\n').filter((l) => l.includes('|'));
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length >= 2) {
        rubricCheck.push({
          criterion: parts[0] ?? '',
          passed: (parts[1] ?? '').toUpperCase().includes('PASS'),
          notes: parts[2] ?? '',
        });
      }
    }
  }

  // Extract revised version
  const revisedMatch = text.match(/=== REVISED VERSION ===([\s\S]*)/);
  const finalVersion = revisedMatch?.[1]?.trim() ?? draft;

  return { finalVersion, rubricCheck };
}

/**
 * Compress text to fit within word limit while preserving rubric coverage.
 */
async function compressToWordLimit(text: string, wordLimit: number, rubric: string | null): Promise<string> {
  const { text: compressed } = await generateText({
    model: getWritingModel(),
    system: `Compress this text to fit within ${wordLimit} words while:
1. Preserving ALL key arguments and evidence
2. Maintaining coverage of all rubric criteria
3. Keeping the academic tone and structure
4. Retaining all citations

Return ONLY the compressed text.`,
    prompt: `TEXT TO COMPRESS (currently ${text.split(/\s+/).length} words, need ${wordLimit} words):
${text}

${rubric ? `RUBRIC CRITERIA TO PRESERVE:\n${rubric}` : ''}`,
    maxOutputTokens: Math.max(wordLimit * 2, 2000),
  });

  return compressed;
}
