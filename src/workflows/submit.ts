import { readFileSync } from 'fs';
import { type Page } from 'playwright';
import { getConfig } from '../config.js';
import { navigateTo, takeScreenshot } from '../browser/browser.js';
import { classifyAssignment } from '../agent/router.js';
import { generateAssignmentContent, type WritingOutput } from '../agent/writing-agent.js';
import { generateDiscussionContent } from '../agent/discussion-agent.js';
import { answerQuiz, buildQuizSummary } from '../agent/quiz-agent.js';
import { buildDocx, generateFileName } from '../documents/docx-builder.js';
import { getAssignmentDetails, submitAssignmentViaBrowser } from '../browser/pages/assignments.js';
import { startQuizAttempt, submitQuiz } from '../browser/pages/quizzes.js';
import { getDiscussionDetails, postToDiscussion, postToDiscussionViaBrowser } from '../browser/pages/discussions.js';
import { requestConfirmation, notifyAutoSubmit } from '../ui/confirmation.js';
import { getBrightspaceClient } from '../api/client.js';
import {
  updateAssignmentStatus,
  updateAssignment,
  logAction,
} from '../db/queries.js';
import { type Assignment } from '../db/schema.js';
import { logger } from '../ui/logger.js';
import { extractPageText } from '../browser/vision.js';

/**
 * Main submission workflow orchestrator.
 * Routes to the correct procedure based on assignment type.
 */
export async function processAssignment(assignment: Assignment): Promise<void> {
  logger.status(assignment.course, assignment.title, 'Processing', assignment.type);
  updateAssignmentStatus(assignment.id, 'in-progress', `Processing as ${assignment.type}`);
  logAction(assignment.id, 'processing_started', `Type: ${assignment.type}`);

  try {
    switch (assignment.type) {
      case 'file-upload':
        await processFileUpload(assignment);
        break;
      case 'inline-text':
        await processInlineText(assignment);
        break;
      case 'quiz':
        await processQuiz(assignment);
        break;
      case 'discussion-post':
        await processDiscussionPost(assignment);
        break;
      case 'external-tool':
        await processExternalTool(assignment);
        break;
      default:
        logger.error(`Unknown assignment type: ${assignment.type}`);
        updateAssignmentStatus(assignment.id, 'failed', 'Unknown assignment type');
    }
  } catch (err) {
    logger.error(`Processing failed: ${err}`, { course: assignment.course, task: assignment.title });
    updateAssignmentStatus(assignment.id, 'failed', `Error: ${err}`);
    logAction(assignment.id, 'processing_failed', String(err));
  }
}

// ── File Upload Procedure ────────────────────────────

async function processFileUpload(assignment: Assignment): Promise<void> {
  const config = getConfig();

  // Phase 1: Extract assignment details
  logger.status(assignment.course, assignment.title, 'Extracting details', 'Phase 1');
  const details = await getAssignmentDetails(
    assignment.courseId ?? '',
    assignment.lmsItemId ?? '',
  );

  updateAssignment(assignment.id, {
    instructions: details.instructions,
    rubric: details.rubric ?? undefined,
  });

  // Phase 2-3: Research + Content Generation
  logger.status(assignment.course, assignment.title, 'Generating content', 'Phase 2-3');
  const writingOutput = await generateAssignmentContent({
    instructions: details.instructions,
    rubric: details.rubric,
    wordLimit: details.wordLimit,
    citationStyle: details.citationStyle,
    fileFormat: details.fileFormat,
    courseContext: assignment.course,
  });

  // Phase 4: Document packaging
  logger.status(assignment.course, assignment.title, 'Building document', 'Phase 4');
  const ext = details.fileFormat ?? 'docx';
  const fileName = generateFileName(undefined, undefined, assignment.title, ext);

  let filePath: string;
  if (ext === 'docx' || ext === 'pdf') {
    filePath = await buildDocx({
      title: assignment.title,
      course: assignment.course,
      date: new Date().toLocaleDateString(),
      fileName,
      content: writingOutput.finalVersion,
    });
  } else {
    // For other formats, save as plain text
    const { writeFileSync } = await import('fs');
    const { resolve } = await import('path');
    const { OUTPUTS_DIR } = await import('../config.js');
    filePath = resolve(OUTPUTS_DIR, fileName);
    writeFileSync(filePath, writingOutput.finalVersion);
  }

  updateAssignment(assignment.id, { filePath });

  // Confirmation gate
  const { confirmed, response } = await requestConfirmation({
    title: assignment.title,
    course: assignment.course,
    type: 'file-upload',
    deadline: assignment.deadline,
    targetUrl: assignment.submissionUrl ?? '',
    fileInfo: `${fileName} (${writingOutput.wordCount} words)`,
    rubricCheck: writingOutput.rubricCheck,
    previewText: writingOutput.finalVersion,
  });

  if (!confirmed) {
    logger.info(`User requested changes: ${response}`);
    updateAssignmentStatus(assignment.id, 'pending', `User changes requested: ${response}`);
    // TODO: Re-enter Phase 3 with user feedback
    return;
  }

  // Submit
  logger.status(assignment.course, assignment.title, 'Submitting', 'uploading');

  // Try API first
  try {
    const client = getBrightspaceClient();
    const fileBuffer = readFileSync(filePath);
    await client.submitToDropbox(
      assignment.courseId ?? '',
      assignment.lmsItemId ?? '',
      { name: fileName, buffer: fileBuffer, mimeType: 'application/octet-stream' },
    );

    // Verify via browser
    const page = await navigateTo(assignment.submissionUrl ?? '', { waitUntil: 'networkidle' });
    const screenshotPath = await takeScreenshot(page, `receipt-${assignment.id}`);
    const receiptText = await extractPageText(page);

    if (receiptText.toLowerCase().includes('submitted') || receiptText.toLowerCase().includes('success')) {
      updateAssignmentStatus(assignment.id, 'submitted', 'Submitted via API', receiptText.substring(0, 500));
      logAction(assignment.id, 'submitted', 'Via API', screenshotPath);
      logger.success(`Submitted: ${assignment.title}`, { course: assignment.course });
    } else {
      throw new Error('API submission not confirmed on page');
    }
  } catch (apiErr) {
    logger.warn(`API submission failed: ${apiErr}. Trying browser upload.`);

    // Fallback to browser upload
    const result = await submitAssignmentViaBrowser(
      assignment.courseId ?? '',
      assignment.lmsItemId ?? '',
      filePath,
    );

    if (result.success) {
      updateAssignmentStatus(assignment.id, 'submitted', 'Submitted via browser', result.receiptText.substring(0, 500));
      logAction(assignment.id, 'submitted', 'Via browser', result.screenshotPath);
      logger.success(`Submitted: ${assignment.title}`, { course: assignment.course });
    } else {
      updateAssignmentStatus(assignment.id, 'failed', `Upload failed. File saved at: ${filePath}`);
      logAction(assignment.id, 'submission_failed', result.receiptText);
      logger.error(`Upload failed. File saved at: ${filePath}`, { course: assignment.course });
    }
  }
}

// ── Inline Text Procedure ────────────────────────────

async function processInlineText(assignment: Assignment): Promise<void> {
  const config = getConfig();

  // Same content generation pipeline as file-upload
  const details = await getAssignmentDetails(
    assignment.courseId ?? '',
    assignment.lmsItemId ?? '',
  );

  const writingOutput = await generateAssignmentContent({
    instructions: details.instructions,
    rubric: details.rubric,
    wordLimit: details.wordLimit,
    citationStyle: details.citationStyle,
    fileFormat: null,
    courseContext: assignment.course,
  });

  // Confirmation gate
  const { confirmed, response } = await requestConfirmation({
    title: assignment.title,
    course: assignment.course,
    type: 'inline-text',
    deadline: assignment.deadline,
    targetUrl: assignment.submissionUrl ?? '',
    fileInfo: `${writingOutput.wordCount} words`,
    rubricCheck: writingOutput.rubricCheck,
    previewText: writingOutput.finalVersion,
  });

  if (!confirmed) {
    updateAssignmentStatus(assignment.id, 'pending', `User changes requested: ${response}`);
    return;
  }

  // Navigate to submission page and inject text
  const page = await navigateTo(assignment.submissionUrl ?? '', { waitUntil: 'networkidle' });

  // Find the text editor
  try {
    // Try contenteditable
    const editor = page.locator('[contenteditable="true"], .d2l-richtext-editor').first();
    if (await editor.isVisible({ timeout: 3000 })) {
      await editor.click();
      // Type char by char to avoid formatting issues
      await page.keyboard.type(writingOutput.finalVersion, { delay: 1 });
    } else {
      // Try textarea
      const textarea = page.locator('textarea').first();
      await textarea.fill(writingOutput.finalVersion);
    }
  } catch (err) {
    // Try iframe editor
    const iframe = page.frameLocator('iframe[class*="editor"], iframe[id*="editor"]').first();
    const body = iframe.locator('body');
    await body.fill(writingOutput.finalVersion);
  }

  await takeScreenshot(page, `inline-text-filled-${assignment.id}`);

  // Submit
  const submitBtn = page.locator('button:has-text("Submit"), input[value*="Submit"]').first();
  await submitBtn.click();
  await page.waitForLoadState('networkidle');

  const screenshotPath = await takeScreenshot(page, `inline-text-receipt-${assignment.id}`);
  const receiptText = await extractPageText(page);

  if (receiptText.toLowerCase().includes('submitted') || receiptText.toLowerCase().includes('success')) {
    updateAssignmentStatus(assignment.id, 'submitted', 'Submitted inline text', receiptText.substring(0, 500));
    logAction(assignment.id, 'submitted', 'Inline text', screenshotPath);
    logger.success(`Submitted: ${assignment.title}`, { course: assignment.course });
  } else {
    updateAssignmentStatus(assignment.id, 'failed', 'Inline submission may have failed');
    logger.error(`Inline submission uncertain for: ${assignment.title}`, { course: assignment.course });
  }
}

// ── Quiz Procedure ───────────────────────────────────

async function processQuiz(assignment: Assignment): Promise<void> {
  const config = getConfig();

  // Start the quiz
  const { page, state } = await startQuizAttempt(
    assignment.courseId ?? '',
    assignment.lmsItemId ?? '',
  );

  // Answer all questions
  const result = await answerQuiz(page, state);
  const summary = buildQuizSummary(result);

  if (result.autoSubmitted) {
    // Already submitted due to timer
    notifyAutoSubmit(assignment.title, assignment.course, summary);
    updateAssignmentStatus(assignment.id, 'submitted', 'Auto-submitted (timer critical)', summary);
    logAction(assignment.id, 'quiz_auto_submitted', summary);
    return;
  }

  // Confirmation gate
  const { confirmed } = await requestConfirmation({
    title: assignment.title,
    course: assignment.course,
    type: 'quiz',
    deadline: assignment.deadline,
    targetUrl: page.url(),
    quizSummary: summary,
  });

  if (!confirmed) {
    updateAssignmentStatus(assignment.id, 'in-progress', 'User reviewing quiz answers');
    return;
  }

  // Submit quiz
  const submission = await submitQuiz(page);

  if (submission.success) {
    updateAssignmentStatus(assignment.id, 'submitted', 'Quiz submitted', submission.receiptText.substring(0, 500));
    logAction(assignment.id, 'quiz_submitted', summary, submission.screenshotPath);
    logger.success(`Quiz submitted: ${assignment.title}`, { course: assignment.course });
  } else {
    updateAssignmentStatus(assignment.id, 'failed', 'Quiz submission uncertain');
    logger.error(`Quiz submission uncertain: ${assignment.title}`, { course: assignment.course });
  }
}

// ── Discussion Post Procedure ────────────────────────

async function processDiscussionPost(assignment: Assignment): Promise<void> {
  // Parse forum/topic IDs from lmsItemId (format: "forumId-topicId")
  const [forumId, topicId] = (assignment.lmsItemId ?? '').split('-');
  if (!forumId || !topicId) {
    updateAssignmentStatus(assignment.id, 'failed', 'Missing forum/topic IDs');
    return;
  }

  // Get discussion details
  const details = await getDiscussionDetails(
    assignment.courseId ?? '',
    forumId,
    topicId,
  );

  // Check if we need to wait for peers
  if (details.requiredReplies > 0 && details.posts.length === 0) {
    logger.info('No peer posts yet. Setting reminder to check back.', { course: assignment.course });
    updateAssignmentStatus(assignment.id, 'waiting-for-peers', 'Waiting for peer posts to reply to');
    return;
  }

  // Generate content
  const content = await generateDiscussionContent({
    prompt: details.prompt,
    existingPeerPosts: details.posts,
    requiredReplies: details.requiredReplies,
    minPostLength: details.minPostLength,
    courseContext: assignment.course,
  });

  // Confirmation gate
  const { confirmed, response } = await requestConfirmation({
    title: assignment.title,
    course: assignment.course,
    type: 'discussion-post',
    deadline: assignment.deadline,
    targetUrl: '',
    previewText: content.originalPost,
    fileInfo: `${content.wordCount} words, ${content.replies.length} replies`,
  });

  if (!confirmed) {
    updateAssignmentStatus(assignment.id, 'pending', `User changes requested: ${response}`);
    return;
  }

  // Post original
  try {
    await postToDiscussion(
      assignment.courseId ?? '',
      forumId,
      topicId,
      assignment.title,
      `<p>${content.originalPost.replace(/\n/g, '</p><p>')}</p>`,
    );
    logAction(assignment.id, 'discussion_posted', 'Original post via API');
  } catch {
    // Fallback to browser
    const { screenshotPath } = await postToDiscussionViaBrowser(
      assignment.courseId ?? '',
      topicId,
      content.originalPost,
    );
    logAction(assignment.id, 'discussion_posted', 'Original post via browser', screenshotPath);
  }

  // Post replies
  for (const reply of content.replies) {
    try {
      await postToDiscussion(
        assignment.courseId ?? '',
        forumId,
        topicId,
        `Re: ${reply.targetAuthor}`,
        `<p>${reply.content.replace(/\n/g, '</p><p>')}</p>`,
        parseInt(reply.targetPostId, 10),
      );
      logAction(assignment.id, 'discussion_reply_posted', `Reply to ${reply.targetAuthor}`);
    } catch (err) {
      logger.warn(`Failed to post reply to ${reply.targetAuthor}: ${err}`);
    }
  }

  updateAssignmentStatus(assignment.id, 'submitted', 'Discussion posted');
  logger.success(`Discussion posted: ${assignment.title}`, { course: assignment.course });
}

// ── External Tool Procedure ──────────────────────────

async function processExternalTool(assignment: Assignment): Promise<void> {
  const config = getConfig();

  // Navigate to the assignment page
  const page = await navigateTo(assignment.submissionUrl ?? '', { waitUntil: 'networkidle' });
  await takeScreenshot(page, `external-tool-${assignment.id}`);

  // Re-classify the page within the external tool
  const actualType = await classifyAssignment(page, { title: assignment.title });

  logger.info(`External tool detected. Inner type: ${actualType}`, { course: assignment.course });

  // Re-route to the appropriate procedure
  const innerAssignment: Assignment = {
    ...assignment,
    type: actualType,
  };

  switch (actualType) {
    case 'quiz':
      await processQuiz(innerAssignment);
      break;
    case 'file-upload':
      await processFileUpload(innerAssignment);
      break;
    default:
      logger.warn(`Unhandled external tool type: ${actualType}`);
      updateAssignmentStatus(assignment.id, 'failed', `External tool type not implemented: ${actualType}`);
  }
}
