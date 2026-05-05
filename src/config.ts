import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Student profile  - used to auto-fill forms, name assignments, etc.
  STUDENT_FIRST_NAME: z.string().min(1),
  STUDENT_LAST_NAME: z.string().min(1),
  STUDENT_EMAIL: z.string().email(),
  STUDENT_ID: z.string().default(''),   // Optional when using session reuse
  STUDENT_PHONE: z.string().optional(),
  STUDENT_MAJOR: z.string().optional(),
  STUDENT_YEAR: z.string().optional(), // Freshman, Sophomore, Junior, Senior, Graduate

  // Brightspace  - optional when BROWSER_PROFILE_PATH is set (session reuse)
  BRIGHTSPACE_BASE_URL: z.string().url().default('https://brightspace.nyu.edu'),
  BRIGHTSPACE_USERNAME: z.string().default(''),  // Not needed with session reuse
  BRIGHTSPACE_PASSWORD: z.string().default(''),  // Not needed with session reuse
  BRIGHTSPACE_TOTP_SECRET: z.string().optional(),

  // AI Providers  - OpenRouter is the default (GPT-4o-mini for everything)
  OPENROUTER_API_KEY: z.string().optional(),  // Default AI provider via OpenRouter

  // Portkey gateway (optional - NYU internal)
  PORTKEY_GATEWAY_URL: z.string().url().default('https://ai-gateway.apps.cloud.rt.nyu.edu/v1'),
  PORTKEY_API_KEY: z.string().optional(),

  // Direct provider keys (optional fallback)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Search APIs
  TAVILY_API_KEY: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),

  // Gmail (optional)
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),

  // Institution
  INSTITUTION_DOMAIN: z.string().default('nyu.edu'),
  INSTITUTION_NAME: z.string().default('New York University'),

  // Agent behavior
  QUIZ_AUTO_SUBMIT_THRESHOLD: z.coerce.number().default(30),
  EMAIL_POLL_INTERVAL: z.coerce.number().default(15),
  BROWSER_HEADLESS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // Computer-use capabilities
  SCREENSHOT_INTERVAL: z.coerce.number().default(2000),
  BROWSER_PROFILE_PATH: z.string().optional(),
  BROWSER_REMOTE_URL: z.string().optional(),  // e.g. http://localhost:9222 for remote debugging
  ACTIVE_TERM: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;
let _demoMode = false;

export function isDemoMode(): boolean {
  return _demoMode;
}

export function setDemoMode(enabled: boolean): void {
  _demoMode = enabled;
}

/** Demo/test config  - no real credentials needed */
const DEMO_CONFIG: Config = {
  STUDENT_FIRST_NAME: 'Alex',
  STUDENT_LAST_NAME: 'Demo',
  STUDENT_EMAIL: 'demo@example.edu',
  STUDENT_ID: 'N00000000',
  STUDENT_PHONE: '',
  STUDENT_MAJOR: '',
  STUDENT_YEAR: '',
  BRIGHTSPACE_BASE_URL: 'https://brightspace.nyu.edu',
  BRIGHTSPACE_USERNAME: 'demo',
  BRIGHTSPACE_PASSWORD: 'demo',
  BRIGHTSPACE_TOTP_SECRET: undefined,
  PORTKEY_GATEWAY_URL: 'https://ai-gateway.apps.cloud.rt.nyu.edu/v1',
  PORTKEY_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  OPENAI_API_KEY: undefined,
  TAVILY_API_KEY: undefined,
  PERPLEXITY_API_KEY: undefined,
  GMAIL_CLIENT_ID: undefined,
  GMAIL_CLIENT_SECRET: undefined,
  GMAIL_REFRESH_TOKEN: undefined,
  INSTITUTION_DOMAIN: 'nyu.edu',
  INSTITUTION_NAME: 'New York University',
  QUIZ_AUTO_SUBMIT_THRESHOLD: 30,
  EMAIL_POLL_INTERVAL: 15,
  BROWSER_HEADLESS: true,
  SCREENSHOT_INTERVAL: 2000,
  BROWSER_PROFILE_PATH: undefined,
  BROWSER_REMOTE_URL: undefined,
  ACTIVE_TERM: undefined,
};

export function loadConfig(): Config {
  if (_config) return _config;

  if (_demoMode) {
    // In demo mode, use demo config but pick up API keys from .env if available
    _config = {
      ...DEMO_CONFIG,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || undefined,
      PORTKEY_API_KEY: process.env.PORTKEY_API_KEY || undefined,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    };
    return _config;
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Missing or invalid environment variables:\n${missing}\n\n` +
      `To fix: open .env and fill in the required values.\n` +
      `To test without credentials: npm start -- --demo`,
    );
  }
  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}

// Derived paths
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '..');
export const DATA_DIR = resolve(PROJECT_ROOT, 'data');
export const OUTPUTS_DIR = resolve(PROJECT_ROOT, 'outputs');
export const SCREENSHOTS_DIR = resolve(PROJECT_ROOT, 'screenshots');
export const SESSION_FILE = resolve(DATA_DIR, 'session.json');
export const DB_PATH = resolve(DATA_DIR, 'assignments.db');
export const PROFILE_FILE = resolve(DATA_DIR, 'profile.json');

// ── Derived config constants ─────────────────────────
export function getScreenshotInterval(): number {
  return getConfig().SCREENSHOT_INTERVAL;
}

export function getBrowserProfilePath(): string | undefined {
  return getConfig().BROWSER_PROFILE_PATH;
}

export function getActiveTerm(): string | undefined {
  return getConfig().ACTIVE_TERM;
}

// ── Student Profile Helper ───────────────────────────
export interface StudentProfile {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  studentId: string;
  phone: string;
  major: string;
  year: string;
  institution: string;
}

export function getStudentProfile(): StudentProfile {
  const config = getConfig();
  return {
    firstName: config.STUDENT_FIRST_NAME,
    lastName: config.STUDENT_LAST_NAME,
    fullName: `${config.STUDENT_FIRST_NAME} ${config.STUDENT_LAST_NAME}`,
    email: config.STUDENT_EMAIL,
    studentId: config.STUDENT_ID,
    phone: config.STUDENT_PHONE ?? '',
    major: config.STUDENT_MAJOR ?? '',
    year: config.STUDENT_YEAR ?? '',
    institution: config.INSTITUTION_NAME,
  };
}
