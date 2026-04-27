import { generateText } from 'ai';
import { getQuickModel } from './providers.js';
import { getConfig } from '../config.js';
import { logger } from '../ui/logger.js';

/**
 * Research Agent  - gathers external sources for assignments.
 *
 * Supports multiple search backends:
 * - Tavily (primary)
 * - Perplexity (fallback)
 * - None (stub  - returns empty results)
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface ResearchResult {
  query: string;
  results: SearchResult[];
  summary: string;
}

// ── Search Provider Abstraction ──────────────────────

interface SearchProvider {
  name: string;
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

class TavilyProvider implements SearchProvider {
  name = 'Tavily';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      results: Array<{
        title: string;
        url: string;
        content: string;
        published_date?: string;
      }>;
    };

    return data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      publishedDate: r.published_date,
    }));
  }
}

class PerplexityProvider implements SearchProvider {
  name = 'Perplexity';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'user',
            content: `Search for: ${query}. Return the top ${maxResults} results with titles, URLs, and brief descriptions.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
    };

    const content = data.choices[0]?.message.content ?? '';
    const citations = data.citations ?? [];

    // Parse the response into structured results
    return citations.slice(0, maxResults).map((url, i) => ({
      title: `Source ${i + 1}`,
      url,
      snippet: content.substring(i * 200, (i + 1) * 200),
    }));
  }
}

class StubProvider implements SearchProvider {
  name = 'Stub';

  async search(_query: string): Promise<SearchResult[]> {
    logger.warn('No search API configured. Returning empty results.');
    return [];
  }
}

// ── Provider Selection ───────────────────────────────

function getSearchProvider(): SearchProvider {
  const config = getConfig();

  if (config.TAVILY_API_KEY) {
    return new TavilyProvider(config.TAVILY_API_KEY);
  }
  if (config.PERPLEXITY_API_KEY) {
    return new PerplexityProvider(config.PERPLEXITY_API_KEY);
  }
  return new StubProvider();
}

// ── Research Functions ───────────────────────────────

/**
 * Generate search queries from assignment instructions.
 */
export async function generateSearchQueries(instructions: string): Promise<string[]> {
  const { text } = await generateText({
    model: getQuickModel(),
    system: `Given assignment instructions, generate 2-4 targeted search queries that would find relevant academic sources, facts, or data needed to complete the assignment. Return one query per line, nothing else.`,
    prompt: instructions.substring(0, 3000),
    maxOutputTokens: 300,
  });

  return text
    .split('\n')
    .map((q) => q.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter((q) => q.length > 5);
}

/**
 * Run research for an assignment.
 * 1. Generate search queries from instructions
 * 2. Search for each query
 * 3. Summarize findings
 */
export async function conductResearch(
  instructions: string,
  citationStyle?: string,
): Promise<ResearchResult[]> {
  const provider = getSearchProvider();
  logger.info(`Conducting research via ${provider.name}`);

  // Generate queries
  const queries = await generateSearchQueries(instructions);
  logger.info(`Generated ${queries.length} search queries`);

  const results: ResearchResult[] = [];

  for (const query of queries) {
    try {
      const searchResults = await provider.search(query, 5);
      logger.debug(`Query "${query}": ${searchResults.length} results`);

      // Summarize results
      const { text: summary } = await generateText({
        model: getQuickModel(),
        system: `Summarize the key facts, data, and quotes from these search results that are relevant to the research query. ${citationStyle ? `Format citations in ${citationStyle} style.` : ''} Be concise but thorough.`,
        prompt: `Query: ${query}\n\nResults:\n${searchResults.map((r) => `[${r.title}](${r.url}): ${r.snippet}`).join('\n\n')}`,
        maxOutputTokens: 1000,
      });

      results.push({ query, results: searchResults, summary });
    } catch (err) {
      logger.warn(`Search failed for query "${query}": ${err}`);
      results.push({ query, results: [], summary: '' });
    }
  }

  return results;
}

/**
 * Format research results into a citation block.
 */
export function formatCitations(results: ResearchResult[], style: string): string {
  const allSources = results.flatMap((r) => r.results);
  const unique = Array.from(new Map(allSources.map((s) => [s.url, s])).values());

  if (unique.length === 0) return '';

  switch (style.toUpperCase()) {
    case 'APA':
      return unique
        .map(
          (s, i) =>
            `[${i + 1}] ${s.title}. Retrieved from ${s.url}${s.publishedDate ? ` (${s.publishedDate})` : ''}`,
        )
        .join('\n');

    case 'MLA':
      return unique
        .map((s) => `"${s.title}." Web. ${s.publishedDate ?? 'n.d.'}. <${s.url}>.`)
        .join('\n');

    case 'CHICAGO':
      return unique
        .map((s) => `${s.title}. Accessed ${new Date().toLocaleDateString()}. ${s.url}.`)
        .join('\n');

    default:
      return unique.map((s, i) => `[${i + 1}] ${s.title}  - ${s.url}`).join('\n');
  }
}
