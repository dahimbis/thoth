import { describe, it, expect } from 'vitest';
import { ASSIGNMENT_TYPES, ASSIGNMENT_STATUSES } from '../src/db/schema.js';

describe('Assignment Types and Statuses', () => {
  it('should define all 5 assignment types', () => {
    expect(ASSIGNMENT_TYPES).toEqual([
      'quiz',
      'file-upload',
      'inline-text',
      'discussion-post',
      'external-tool',
    ]);
  });

  it('should define all 6 assignment statuses', () => {
    expect(ASSIGNMENT_STATUSES).toEqual([
      'pending',
      'in-progress',
      'waiting-for-peers',
      'ready',
      'submitted',
      'failed',
    ]);
  });
});

describe('Module Exports', () => {
  it('should export the assignment type router', async () => {
    const module = await import('../src/agent/router.js');
    expect(module.classifyAssignment).toBeDefined();
    expect(typeof module.classifyAssignment).toBe('function');
  });

  it('should export AI provider functions', async () => {
    const module = await import('../src/agent/providers.js');
    expect(module.MODELS).toBeDefined();
    expect(module.getModel).toBeDefined();
    expect(module.getWritingModel).toBeDefined();
    expect(module.getQuickModel).toBeDefined();
    expect(module.getClassifierModel).toBeDefined();
    expect(module.getFastModel).toBeDefined();
  });

  it('should have correct model IDs', async () => {
    const { MODELS } = await import('../src/agent/providers.js');
    expect(MODELS.CLAUDE_SONNET).toContain('anthropic');
    expect(MODELS.GPT_MAIN).toContain('gpt');
    expect(MODELS.GEMINI_PRO).toContain('gemini');
  });
});
