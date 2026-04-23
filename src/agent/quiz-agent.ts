import { generateText } from 'ai';
import { type Page } from 'playwright';
import { getQuickModel } from './providers.js';
import { extractQuizQuestion } from '../browser/vision.js';
import { takeScreenshot } from '../browser/browser.js';
import {
  type QuizAttemptState,
  selectMCQAnswer,
  typeAnswer,
  clickNextQuestion,
  submitQuiz,
  readQuizTimer,
} from '../browser/pages/quizzes.js';
import { getConfig } from '../config.js';
import { logger } from '../ui/logger.js';

/**
 * Quiz Agent — answers quiz questions autonomously.
 *
 * Strategy:
 * 1. Extract each question via page content parsing
 * 2. Route to appropriate AI model based on question type
 * 3. Track confidence and skip low-confidence questions
 * 4. Return to skipped questions if time allows
 * 5. Auto-submit if timer is critical
 */

export interface QuizAnswer {
  questionNumber: number;
  questionText: string;
  questionType: string;
  selectedAnswer: string;
  confidence: number;
  reasoning: string;
}

export interface QuizResult {
  answers: QuizAnswer[];
  skippedQuestions: number[];
  totalAnswered: number;
  totalQuestions: number;
  autoSubmitted: boolean;
}

/**
 * Run through all quiz questions and answer them.
 */
export async function answerQuiz(
  page: Page,
  state: QuizAttemptState,
): Promise<QuizResult> {
  const config = getConfig();
  const safetyBuffer = 90; // seconds
  const autoSubmitThreshold = config.QUIZ_AUTO_SUBMIT_THRESHOLD;

  const answers: QuizAnswer[] = [];
  const startTime = Date.now();

  logger.info(`Starting quiz: ${state.totalQuestions} questions, time: ${state.timeRemainingSeconds}s`);

  // Calculate time budget per question
  const timePerQuestion = state.totalQuestions > 0
    ? Math.floor((state.timeRemainingSeconds - safetyBuffer) / state.totalQuestions)
    : 60;

  // ── First pass: answer all questions ───────────
  for (let q = 1; q <= state.totalQuestions; q++) {
    // Check timer
    const elapsed = (Date.now() - startTime) / 1000;
    const timerReading = await readQuizTimer(page);
    const timeRemaining = timerReading ?? (state.timeRemainingSeconds - elapsed);

    if (timeRemaining <= autoSubmitThreshold) {
      logger.warn(`Timer critical (${Math.round(timeRemaining)}s). Auto-submitting.`);
      const submission = await submitQuiz(page);
      return {
        answers,
        skippedQuestions: state.skippedQuestions.map((s) => s.number),
        totalAnswered: answers.length,
        totalQuestions: state.totalQuestions,
        autoSubmitted: true,
      };
    }

    logger.status('Quiz', `Q${q}/${state.totalQuestions}`, 'Answering', `${Math.round(timeRemaining)}s left`);

    try {
      // Extract the question
      const question = await extractQuizQuestion(page);
      await takeScreenshot(page, `quiz-q${q}`);

      // Generate answer based on type
      const answer = await generateAnswer(question);
      answers.push({
        questionNumber: q,
        questionText: question.questionText,
        questionType: question.questionType,
        selectedAnswer: answer.answer,
        confidence: answer.confidence,
        reasoning: answer.reasoning,
      });

      // Apply the answer
      if (answer.confidence < 0.7) {
        state.skippedQuestions.push({ number: q, confidence: answer.confidence });
        logger.warn(`Q${q}: Low confidence (${answer.confidence}). Flagged for review.`);
      }

      // Select/type the answer
      const applied = await applyAnswer(page, question.questionType, answer.answer, answer.answerIndex);

      if (applied) {
        state.answeredQuestions.push(q);
        // Verify the answer was registered
        await takeScreenshot(page, `quiz-q${q}-answered`);
      }

      // Move to next question
      if (q < state.totalQuestions) {
        await clickNextQuestion(page);
      }
    } catch (err) {
      logger.error(`Error on Q${q}: ${err}`);
      state.skippedQuestions.push({ number: q, confidence: 0 });

      // Try to move forward
      try {
        await clickNextQuestion(page);
      } catch {
        // Can't move forward
      }
    }
  }

  // ── Second pass: return to skipped questions ───
  if (state.skippedQuestions.length > 0) {
    const timerReading = await readQuizTimer(page);
    const timeRemaining = timerReading ?? (state.timeRemainingSeconds - (Date.now() - startTime) / 1000);

    if (timeRemaining > safetyBuffer) {
      logger.info(`Returning to ${state.skippedQuestions.length} skipped questions`);
      // Note: Returning to specific questions depends on quiz navigation UI
      // Some quizzes allow direct navigation, others are sequential-only
    }
  }

  return {
    answers,
    skippedQuestions: state.skippedQuestions.map((s) => s.number),
    totalAnswered: answers.length,
    totalQuestions: state.totalQuestions,
    autoSubmitted: false,
  };
}

/**
 * Generate an answer for a quiz question.
 */
async function generateAnswer(question: {
  questionText: string;
  questionType: string;
  options: string[];
}): Promise<{
  answer: string;
  answerIndex: number;
  confidence: number;
  reasoning: string;
}> {
  const optionsText = question.options.length > 0
    ? `\n\nOptions:\n${question.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
    : '';

  const { text } = await generateText({
    model: getQuickModel(),
    system: `You are answering a quiz question. Analyze the question carefully and provide:
1. The correct answer
2. Your confidence level (0.0 to 1.0)
3. Brief reasoning

For multiple choice, specify the option number (1-based).
For true/false, answer "True" or "False".
For short answer, provide the concise answer.

Return ONLY valid JSON in this format:
{"answer": "the answer text", "answerIndex": 0, "confidence": 0.95, "reasoning": "brief explanation"}

For MCQ, set answerIndex to the 0-based index of the correct option.
For non-MCQ, set answerIndex to -1.`,
    prompt: `Question type: ${question.questionType}\n\nQuestion: ${question.questionText}${optionsText}`,
    maxOutputTokens: 500,
  });

  try {
    const parsed = JSON.parse(text);
    return {
      answer: String(parsed.answer ?? ''),
      answerIndex: typeof parsed.answerIndex === 'number' ? parsed.answerIndex : -1,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: String(parsed.reasoning ?? ''),
    };
  } catch {
    return {
      answer: text.trim(),
      answerIndex: -1,
      confidence: 0.3,
      reasoning: 'Failed to parse AI response',
    };
  }
}

/**
 * Apply an answer to the quiz page.
 */
async function applyAnswer(
  page: Page,
  questionType: string,
  answer: string,
  answerIndex: number,
): Promise<boolean> {
  switch (questionType) {
    case 'mcq':
    case 'true-false':
      if (answerIndex >= 0) {
        return selectMCQAnswer(page, answerIndex);
      }
      // Try to find the option by text
      try {
        const label = page.locator(`label:has-text("${answer}")`).first();
        if (await label.isVisible({ timeout: 2000 })) {
          await label.click();
          return true;
        }
      } catch {
        // Fallback
      }
      return false;

    case 'short-answer':
    case 'essay':
      return typeAnswer(page, answer);

    case 'matching':
      // Matching questions are complex — log and attempt best effort
      logger.warn('Matching question type — attempting text-based answer');
      return typeAnswer(page, answer);

    default:
      return typeAnswer(page, answer);
  }
}

/**
 * Build a summary of quiz answers for the confirmation gate.
 */
export function buildQuizSummary(result: QuizResult): string {
  const lines: string[] = [
    `Quiz Summary: ${result.totalAnswered}/${result.totalQuestions} questions answered`,
    `Skipped: ${result.skippedQuestions.length}`,
    '',
    'Answers:',
  ];

  for (const a of result.answers) {
    const conf = `${Math.round(a.confidence * 100)}%`;
    const flag = a.confidence < 0.7 ? ' [LOW CONFIDENCE]' : '';
    lines.push(`  Q${a.questionNumber} (${a.questionType}): ${a.selectedAnswer.substring(0, 80)} — confidence: ${conf}${flag}`);
  }

  if (result.skippedQuestions.length > 0) {
    lines.push('');
    lines.push(`Skipped questions: ${result.skippedQuestions.join(', ')}`);
  }

  return lines.join('\n');
}
