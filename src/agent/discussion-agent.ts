import { generateText } from 'ai';
import { getQuickModel } from './providers.js';
import { type PeerPost } from '../browser/pages/discussions.js';
import { logger } from '../ui/logger.js';

/**
 * Discussion Post Agent  - generates original posts and peer replies.
 *
 * Rules:
 * - Original post adds a new angle, not repeating peers
 * - Each reply targets a different peer post
 * - Each reply adds new content, not just agreement
 * - Meets minimum word requirements
 */

export interface DiscussionInput {
  prompt: string;
  existingPeerPosts: PeerPost[];
  requiredReplies: number;
  minPostLength: number | null;
  courseContext?: string;
}

export interface DiscussionOutput {
  originalPost: string;
  replies: Array<{
    targetPostId: string;
    targetAuthor: string;
    content: string;
  }>;
  wordCount: number;
}

/**
 * Generate a discussion post and any required replies.
 */
export async function generateDiscussionContent(input: DiscussionInput): Promise<DiscussionOutput> {
  logger.info('Generating discussion content');

  // Generate original post
  const originalPost = await generateOriginalPost(input);

  // Generate replies if needed and peers have posted
  const replies: DiscussionOutput['replies'] = [];

  if (input.requiredReplies > 0 && input.existingPeerPosts.length > 0) {
    const postsToReplyTo = input.existingPeerPosts.slice(0, input.requiredReplies);

    for (const peerPost of postsToReplyTo) {
      const reply = await generateReply(input.prompt, peerPost, input.minPostLength);
      replies.push({
        targetPostId: peerPost.postId,
        targetAuthor: peerPost.author,
        content: reply,
      });
    }
  }

  const wordCount =
    originalPost.split(/\s+/).length +
    replies.reduce((sum, r) => sum + r.content.split(/\s+/).length, 0);

  logger.success(`Discussion content generated: ${wordCount} total words, ${replies.length} replies`);

  return { originalPost, replies, wordCount };
}

/**
 * Generate the original discussion post.
 */
async function generateOriginalPost(input: DiscussionInput): Promise<string> {
  const peerSummary = input.existingPeerPosts.length > 0
    ? `\n\nEXISTING PEER POSTS (do NOT repeat these perspectives):\n${input.existingPeerPosts
        .map((p) => `- ${p.author}: ${p.content.substring(0, 300)}`)
        .join('\n')}`
    : '';

  const { text } = await generateText({
    model: getQuickModel(),
    system: `Write a substantive, original discussion post for a university course. Requirements:
1. Directly address the discussion prompt
2. Add a unique perspective or angle that peers have not covered
3. Support your points with reasoning or evidence
4. Be specific  - avoid generic statements
5. Write in first person, conversational academic tone
${input.minPostLength ? `6. Minimum length: ${input.minPostLength} words` : '6. Aim for 200-400 words'}

Do NOT start with "I agree" or "Great point." Lead with your own substantive argument.
Do NOT include any meta-commentary. Write only the post content.`,
    prompt: `DISCUSSION PROMPT:
${input.prompt}
${peerSummary}
${input.courseContext ? `\nCOURSE CONTEXT: ${input.courseContext}` : ''}`,
    maxOutputTokens: 1500,
  });

  return text;
}

/**
 * Generate a reply to a specific peer post.
 */
async function generateReply(
  discussionPrompt: string,
  peerPost: PeerPost,
  minLength: number | null,
): Promise<string> {
  const { text } = await generateText({
    model: getQuickModel(),
    system: `Write a thoughtful reply to a peer's discussion post. Requirements:
1. Engage specifically with the peer's argument  - reference their points
2. Add NEW content: a different perspective, additional evidence, or a follow-up question
3. Do not simply agree or repeat what they said
4. Be respectful but substantive
${minLength ? `5. Minimum length: ${minLength} words` : '5. Aim for 100-200 words'}

Do NOT start with generic phrases like "Great post!" or "I agree with everything."
Write only the reply content.`,
    prompt: `ORIGINAL DISCUSSION PROMPT:
${discussionPrompt}

PEER POST by ${peerPost.author}:
${peerPost.content}`,
    maxOutputTokens: 800,
  });

  return text;
}
