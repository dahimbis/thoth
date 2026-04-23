import { type Page } from 'playwright';
import { getConfig } from '../../config.js';
import { navigateTo, takeScreenshot } from '../browser.js';
import { extractPageText } from '../vision.js';
import { getBrightspaceClient } from '../../api/client.js';
import { logger } from '../../ui/logger.js';

export interface DiscussionInfo {
  title: string;
  forumId: string;
  topicId: string;
  lmsItemId: string; // composite: forumId-topicId
  deadline: string;
  prompt: string;
  requiredReplies: number;
  minPostLength: number | null;
  existingPosts: PeerPost[];
  hasPosted: boolean;
}

export interface PeerPost {
  author: string;
  content: string;
  postId: string;
  date: string;
}

/**
 * Scan all discussion forums and topics for a course.
 */
export async function scanDiscussions(orgUnitId: string, courseName: string): Promise<DiscussionInfo[]> {
  logger.info('Scanning discussions...', { course: courseName });

  try {
    return await scanDiscussionsViaApi(orgUnitId, courseName);
  } catch (err) {
    logger.warn(`API discussion scan failed: ${err}. Falling back to browser.`, { course: courseName });
    return scanDiscussionsViaBrowser(orgUnitId, courseName);
  }
}

async function scanDiscussionsViaApi(orgUnitId: string, courseName: string): Promise<DiscussionInfo[]> {
  const client = getBrightspaceClient();
  const forums = await client.getDiscussionForums(orgUnitId);
  const results: DiscussionInfo[] = [];

  for (const forum of forums) {
    const f = forum as {
      ForumId?: number;
      Name?: string;
    };

    if (!f.ForumId) continue;

    const topics = await client.getDiscussionTopics(orgUnitId, String(f.ForumId));

    for (const topic of topics) {
      const t = topic as {
        TopicId?: number;
        Name?: string;
        Description?: { Html?: string };
        StartDate?: string;
        EndDate?: string;
      };

      if (!t.TopicId || !t.Name) continue;

      results.push({
        title: t.Name,
        forumId: String(f.ForumId),
        topicId: String(t.TopicId),
        lmsItemId: `${f.ForumId}-${t.TopicId}`,
        deadline: t.EndDate ?? '2099-12-31T23:59:59Z',
        prompt: t.Description?.Html ?? '',
        requiredReplies: 0, // Can't determine from API alone
        minPostLength: null,
        existingPosts: [],
        hasPosted: false,
      });
    }
  }

  logger.info(`Found ${results.length} discussion topics via API`, { course: courseName });
  return results;
}

async function scanDiscussionsViaBrowser(orgUnitId: string, courseName: string): Promise<DiscussionInfo[]> {
  const config = getConfig();
  const page = await navigateTo(
    `${config.BRIGHTSPACE_BASE_URL}/d2l/le/${orgUnitId}/discussions/List`,
    { waitUntil: 'networkidle' },
  );

  await takeScreenshot(page, `discussions-${orgUnitId}`);

  // Extract discussion topics from the page
  const topics = await page.evaluate(() => {
    const results: Array<{
      title: string;
      forumId: string;
      topicId: string;
      url: string;
    }> = [];

    const links = document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="discussions"], a[href*="topic"]',
    );

    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      const title = link.textContent?.trim() ?? '';
      if (!title || title.length < 3) continue;

      // Extract IDs from URL
      const forumMatch = href.match(/forumId=(\d+)/);
      const topicMatch = href.match(/topicId=(\d+)/);

      if (forumMatch && topicMatch) {
        results.push({
          title,
          forumId: forumMatch[1]!,
          topicId: topicMatch[1]!,
          url: href,
        });
      }
    }

    return results;
  });

  const results: DiscussionInfo[] = topics.map((t) => ({
    title: t.title,
    forumId: t.forumId,
    topicId: t.topicId,
    lmsItemId: `${t.forumId}-${t.topicId}`,
    deadline: '2099-12-31T23:59:59Z',
    prompt: '',
    requiredReplies: 0,
    minPostLength: null,
    existingPosts: [],
    hasPosted: false,
  }));

  logger.info(`Found ${results.length} discussion topics via browser`, { course: courseName });
  return results;
}

/**
 * Get full details of a discussion topic, including existing posts.
 */
export async function getDiscussionDetails(
  orgUnitId: string,
  forumId: string,
  topicId: string,
): Promise<{
  prompt: string;
  requiredReplies: number;
  minPostLength: number | null;
  posts: PeerPost[];
  hasPosted: boolean;
}> {
  const client = getBrightspaceClient();

  // Get topic posts via API
  let posts: PeerPost[] = [];
  let prompt = '';
  let hasPosted = false;

  try {
    const apiPosts = await client.getDiscussionPosts(orgUnitId, forumId, topicId);

    posts = (apiPosts as Array<{
      PostId?: number;
      PostingUserId?: number;
      Subject?: string;
      Message?: { Html?: string };
      DatePosted?: string;
      PostingUserDisplayName?: string;
    }>).map((p) => ({
      author: p.PostingUserDisplayName ?? 'Unknown',
      content: p.Message?.Html ?? '',
      postId: String(p.PostId ?? ''),
      date: p.DatePosted ?? '',
    }));
  } catch {
    // Fall back to browser extraction
    const config = getConfig();
    const page = await navigateTo(
      `${config.BRIGHTSPACE_BASE_URL}/d2l/le/${orgUnitId}/discussions/topics/${topicId}/View`,
      { waitUntil: 'networkidle' },
    );

    prompt = await extractPageText(page);
  }

  // Parse required replies from prompt text
  let requiredReplies = 0;
  const replyMatch = prompt.match(/(\d+)\s*(?:reply|replies|response|responses)\s*(?:required|to\s*peers)/i);
  if (replyMatch) {
    requiredReplies = parseInt(replyMatch[1]!, 10);
  }

  // Parse min length
  let minPostLength: number | null = null;
  const lenMatch = prompt.match(/(?:minimum|at\s*least)\s*(\d+)\s*words/i);
  if (lenMatch) {
    minPostLength = parseInt(lenMatch[1]!, 10);
  }

  return { prompt, requiredReplies, minPostLength, posts, hasPosted };
}

/**
 * Post to a discussion topic via the API.
 */
export async function postToDiscussion(
  orgUnitId: string,
  forumId: string,
  topicId: string,
  subject: string,
  htmlContent: string,
  parentPostId?: number,
): Promise<unknown> {
  const client = getBrightspaceClient();

  return client.createDiscussionPost(orgUnitId, forumId, topicId, {
    Subject: subject,
    Message: { Html: htmlContent },
    ParentPostId: parentPostId ?? null,
  });
}

/**
 * Post to a discussion via the browser (fallback).
 */
export async function postToDiscussionViaBrowser(
  orgUnitId: string,
  topicId: string,
  content: string,
): Promise<{ success: boolean; screenshotPath: string }> {
  const config = getConfig();
  const page = await navigateTo(
    `${config.BRIGHTSPACE_BASE_URL}/d2l/le/${orgUnitId}/discussions/topics/${topicId}/View`,
    { waitUntil: 'networkidle' },
  );

  // Click "Start a New Thread" or "Reply"
  const newThreadSelectors = [
    'button:has-text("Start a New Thread")',
    'button:has-text("New Thread")',
    'a:has-text("Start a New Thread")',
    'button:has-text("Compose")',
  ];

  for (const selector of newThreadSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await page.waitForLoadState('domcontentloaded');
        break;
      }
    } catch {
      // Try next
    }
  }

  // Fill in the post content
  // Try rich text editor first
  try {
    const iframe = page.frameLocator('iframe[class*="editor"], iframe[id*="editor"]').first();
    const body = iframe.locator('body');
    await body.fill(content);
  } catch {
    // Try textarea fallback
    const textarea = page.locator('textarea').first();
    await textarea.fill(content);
  }

  // Submit
  const postBtn = page.locator('button:has-text("Post"), input[value*="Post"], button[type="submit"]').first();
  await postBtn.click();
  await page.waitForLoadState('networkidle');

  const screenshotPath = await takeScreenshot(page, `discussion-posted-${topicId}`);
  return { success: true, screenshotPath };
}
