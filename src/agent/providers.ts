import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getConfig } from '../config.js';
import type { LanguageModel } from 'ai';

// ── Provider Registry ────────────────────────────────
// Default: OpenRouter with GPT-4o-mini for everything.
// If Portkey or direct OpenAI/Anthropic keys are configured, those are used instead.
// Priority: OpenRouter (default) > Portkey > Direct OpenAI > Direct Anthropic

interface ProviderRegistry {
  openrouter: ReturnType<typeof createOpenAICompatible> | null;
  portkey: ReturnType<typeof createOpenAICompatible> | null;
  openaiDirect: ReturnType<typeof createOpenAICompatible> | null;
  anthropicDirect: ReturnType<typeof createOpenAICompatible> | null;
}

let _providers: ProviderRegistry | null = null;

function initProviders(): ProviderRegistry {
  if (_providers) return _providers;

  const config = getConfig();

  // Default: OpenRouter (works with GPT-4o-mini, Claude, etc.)
  const openrouter = config.OPENROUTER_API_KEY
    ? createOpenAICompatible({
        name: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.OPENROUTER_API_KEY,
        headers: {
          'HTTP-Referer': 'https://github.com/dahimbis/thoth',
          'X-Title': 'Thoth LMS Agent',
        },
      })
    : null;

  // Optional: Portkey gateway (NYU internal)
  const portkey = config.PORTKEY_API_KEY
    ? createOpenAICompatible({
        name: 'portkey',
        baseURL: config.PORTKEY_GATEWAY_URL,
        apiKey: config.PORTKEY_API_KEY,
        headers: {
          'x-portkey-api-key': config.PORTKEY_API_KEY,
        },
      })
    : null;

  // Optional: Direct OpenAI
  const openaiDirect = config.OPENAI_API_KEY
    ? createOpenAICompatible({
        name: 'openai-direct',
        baseURL: 'https://api.openai.com/v1',
        apiKey: config.OPENAI_API_KEY,
      })
    : null;

  // Optional: Direct Anthropic
  const anthropicDirect = config.ANTHROPIC_API_KEY
    ? createOpenAICompatible({
        name: 'anthropic-direct',
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: config.ANTHROPIC_API_KEY,
      })
    : null;

  _providers = { openrouter, portkey, openaiDirect, anthropicDirect };
  return _providers;
}

// ── Model Selection ──────────────────────────────────
// Default model: openai/gpt-4o-mini via OpenRouter
// All tasks use this unless you configure other providers.

export const MODELS = {
  // Default for everything (via OpenRouter)
  DEFAULT: 'openai/gpt-4o-mini',

  // Writing/long-form (uses Claude if Portkey/Anthropic configured, else default)
  CLAUDE_SONNET: 'anthropic/claude-3.5-sonnet',
  CLAUDE_HAIKU: 'anthropic/claude-3.5-haiku',

  // GPT models (via OpenRouter)
  GPT_MAIN: 'openai/gpt-4o-mini',
  GPT_MINI: 'openai/gpt-4o-mini',

  // Gemini (via OpenRouter)
  GEMINI_PRO: 'google/gemini-pro-1.5',
  GEMINI_FLASH: 'google/gemini-flash-1.5',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * Get an AI model instance.
 * Priority: OpenRouter > Portkey > Direct OpenAI > Direct Anthropic
 * Default model: openai/gpt-4o-mini
 */
export function getModel(modelId: ModelId = MODELS.DEFAULT): LanguageModel {
  const providers = initProviders();

  // 1. OpenRouter (default - works for all models)
  if (providers.openrouter) {
    return providers.openrouter.chatModel(modelId);
  }

  // 2. Portkey gateway
  if (providers.portkey) {
    // Strip the provider prefix for Portkey (e.g., "openai/gpt-4o-mini" -> "gpt-4o-mini")
    const modelName = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
    return providers.portkey.chatModel(modelName);
  }

  // 3. Direct OpenAI
  if (providers.openaiDirect && (modelId.includes('gpt') || modelId.includes('openai'))) {
    const modelName = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
    return providers.openaiDirect.chatModel(modelName);
  }

  // 4. Direct Anthropic
  if (providers.anthropicDirect && modelId.includes('anthropic')) {
    const modelName = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
    return providers.anthropicDirect.chatModel(modelName);
  }

  throw new Error(
    `No AI provider configured. Add one of these to your .env:\n` +
    `  OPENROUTER_API_KEY=sk-or-...\n` +
    `  OPENAI_API_KEY=sk-...\n` +
    `  PORTKEY_API_KEY=...\n` +
    `  ANTHROPIC_API_KEY=sk-ant-...`,
  );
}

// ── Task-Specific Model Selectors ────────────────────
// All default to GPT-4o-mini via OpenRouter.
// If you configure Portkey/Anthropic, writing tasks will use Claude.

/** Model for document generation, rubric analysis, long-form writing */
export function getWritingModel(): LanguageModel {
  const providers = initProviders();
  // Use Claude for writing if available, otherwise default
  if (providers.portkey || providers.anthropicDirect) {
    return getModel(MODELS.CLAUDE_SONNET);
  }
  return getModel(MODELS.DEFAULT);
}

/** Model for quizzes, classification, short-form tasks, discussion posts */
export function getQuickModel(): LanguageModel {
  return getModel(MODELS.DEFAULT);
}

/** Lighter model for simple classification tasks */
export function getClassifierModel(): LanguageModel {
  return getModel(MODELS.DEFAULT);
}

/** Fast model for trivial extractions */
export function getFastModel(): LanguageModel {
  return getModel(MODELS.DEFAULT);
}
