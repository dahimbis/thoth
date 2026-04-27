import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getConfig } from '../config.js';
import type { LanguageModel } from 'ai';

// ── Provider Registry ────────────────────────────────
// All AI calls go through this module. The primary path is via
// the Portkey gateway. Direct provider keys are used as fallback.

interface ProviderRegistry {
  portkey: ReturnType<typeof createOpenAICompatible> | null;
  anthropicDirect: ReturnType<typeof createOpenAICompatible> | null;
  openaiDirect: ReturnType<typeof createOpenAICompatible> | null;
}

let _providers: ProviderRegistry | null = null;

function initProviders(): ProviderRegistry {
  if (_providers) return _providers;

  const config = getConfig();

  // Primary: Portkey gateway
  const portkey = createOpenAICompatible({
    name: 'portkey',
    baseURL: config.PORTKEY_GATEWAY_URL,
    apiKey: config.PORTKEY_API_KEY,
    headers: {
      'x-portkey-api-key': config.PORTKEY_API_KEY,
    },
  });

  // Fallback: Direct Anthropic
  const anthropicDirect = config.ANTHROPIC_API_KEY
    ? createOpenAICompatible({
        name: 'anthropic-direct',
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: config.ANTHROPIC_API_KEY,
      })
    : null;

  // Fallback: Direct OpenAI
  const openaiDirect = config.OPENAI_API_KEY
    ? createOpenAICompatible({
        name: 'openai-direct',
        baseURL: 'https://api.openai.com/v1',
        apiKey: config.OPENAI_API_KEY,
      })
    : null;

  _providers = { portkey, anthropicDirect, openaiDirect };
  return _providers;
}

// ── Model Selection ──────────────────────────────────
// These model IDs map to the Portkey gateway routing config.
// If Portkey is down, we fall back to direct provider keys.

export const MODELS = {
  // Claude  - used for document generation, rubric analysis, long-form writing
  CLAUDE_SONNET: '@vertexai/anthropic.claude-sonnet-4-6',
  CLAUDE_HAIKU: '@vertexai/anthropic.claude-haiku-4-5@20251001',

  // GPT  - used for quizzes, classification, short-form tasks
  GPT_MAIN: 'gpt-5.4',
  GPT_MINI: 'gpt-5.4-mini',
  GPT_NANO: 'gpt-5.4-nano',

  // Gemini  - available as alternative
  GEMINI_PRO: 'gemini-2.5-pro',
  GEMINI_FLASH: 'gemini-2.5-flash',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * Get an AI model instance by model ID.
 * Routes through Portkey by default, falls back to direct APIs.
 */
export function getModel(modelId: ModelId): LanguageModel {
  const providers = initProviders();

  // Primary: Portkey gateway
  if (providers.portkey) {
    return providers.portkey.chatModel(modelId);
  }

  // Fallback routing based on model prefix
  if (modelId.includes('anthropic') && providers.anthropicDirect) {
    return providers.anthropicDirect.chatModel(modelId);
  }
  if (modelId.startsWith('gpt') && providers.openaiDirect) {
    return providers.openaiDirect.chatModel(modelId);
  }

  throw new Error(
    `No provider available for model "${modelId}". ` +
      'Configure PORTKEY_API_KEY or the appropriate direct provider key in .env',
  );
}

// ── Task-Specific Model Selectors ────────────────────
// These enforce the routing rules from the system prompt:
//   claude_api  -> document generation, DOCX, long-form writing, rubric analysis
//   openai_api  -> quizzes, short tasks, classification, discussion posts
//   search_api  -> research, citations, fact-checking

/** Model for document generation, rubric analysis, long-form writing */
export function getWritingModel(): LanguageModel {
  return getModel(MODELS.CLAUDE_SONNET);
}

/** Model for quizzes, classification, short-form tasks, discussion posts */
export function getQuickModel(): LanguageModel {
  return getModel(MODELS.GPT_MAIN);
}

/** Lighter model for simple classification tasks */
export function getClassifierModel(): LanguageModel {
  return getModel(MODELS.GPT_MINI);
}

/** Fast model for trivial extractions */
export function getFastModel(): LanguageModel {
  return getModel(MODELS.GPT_NANO);
}
