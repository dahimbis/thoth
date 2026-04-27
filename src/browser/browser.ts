import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { getConfig, SESSION_FILE, DATA_DIR, SCREENSHOTS_DIR, getBrowserProfilePath } from '../config.js';
import { logger } from '../ui/logger.js';
import { emitBrowserAction } from './automation-tracker.js';

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _page: Page | null = null;

// ── Cookie Types ─────────────────────────────────────
interface CookieData {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  savedAt: string;
}

// ── Browser Lifecycle ────────────────────────────────

export async function launchBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;

  const config = getConfig();
  const profilePath = getBrowserProfilePath();

  logger.info('Launching browser', { status: config.BROWSER_HEADLESS ? 'headless' : 'headed' });

  // Session reuse: use persistent context with user's browser profile
  if (profilePath) {
    logger.info(`Using browser profile for session reuse: ${profilePath}`);
    _context = await chromium.launchPersistentContext(profilePath, {
      headless: config.BROWSER_HEADLESS,
      viewport: { width: 1280, height: 900 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });
    // Extract the browser from the persistent context
    _browser = _context.browser()!;
    _browser.on('disconnected', () => {
      logger.warn('Browser disconnected');
      _browser = null;
      _context = null;
      _page = null;
    });
    return _browser;
  }

  // Standard launch (no session reuse)
  _browser = await chromium.launch({
    headless: config.BROWSER_HEADLESS,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });

  _browser.on('disconnected', () => {
    logger.warn('Browser disconnected');
    _browser = null;
    _context = null;
    _page = null;
  });

  return _browser;
}

export async function getContext(): Promise<BrowserContext> {
  if (_context) return _context;

  const browser = await launchBrowser();

  _context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  // Load saved cookies if available
  await loadSession();

  return _context;
}

export async function getPage(): Promise<Page> {
  if (_page && !_page.isClosed()) return _page;

  const context = await getContext();
  _page = await context.newPage();

  // Default timeout
  _page.setDefaultTimeout(30_000);
  _page.setDefaultNavigationTimeout(60_000);

  return _page;
}

// ── Session Management ───────────────────────────────

export async function saveSession(): Promise<void> {
  if (!_context) return;

  const cookies = await _context.cookies();
  const data: CookieData = {
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    })),
    savedAt: new Date().toISOString(),
  };

  const dir = dirname(SESSION_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  logger.debug('Session cookies saved', { status: `${cookies.length} cookies` });
}

export async function loadSession(): Promise<boolean> {
  if (!_context) return false;
  if (!existsSync(SESSION_FILE)) return false;

  try {
    const raw = readFileSync(SESSION_FILE, 'utf-8');
    const data: CookieData = JSON.parse(raw);

    // Check if any cookies are expired
    const now = Date.now() / 1000;
    const validCookies = data.cookies.filter((c) => c.expires === -1 || c.expires > now);

    if (validCookies.length === 0) {
      logger.warn('All saved cookies expired');
      return false;
    }

    await _context.addCookies(validCookies);
    logger.debug('Session cookies loaded', { status: `${validCookies.length} cookies` });
    return true;
  } catch (err) {
    logger.warn(`Failed to load session: ${err}`);
    return false;
  }
}

export function isSessionExpired(): boolean {
  if (!existsSync(SESSION_FILE)) return true;

  try {
    const raw = readFileSync(SESSION_FILE, 'utf-8');
    const data: CookieData = JSON.parse(raw);
    const now = Date.now() / 1000;

    // Check if critical auth cookies are expired
    const authCookies = data.cookies.filter(
      (c) => c.name.includes('session') || c.name.includes('auth') || c.name.includes('d2l'),
    );
    return authCookies.every((c) => c.expires !== -1 && c.expires < now);
  } catch {
    return true;
  }
}

// ── Screenshot Utilities ─────────────────────────────

export async function takeScreenshot(
  page: Page,
  name: string,
  options?: { fullPage?: boolean },
): Promise<string> {
  if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const timestamp = Date.now();
  const filename = `${name}-${timestamp}.png`;
  const filepath = resolve(SCREENSHOTS_DIR, filename);

  await page.screenshot({
    path: filepath,
    fullPage: options?.fullPage ?? false,
  });

  logger.debug(`Screenshot saved: ${filename}`);
  emitBrowserAction({
    actionType: 'screenshot',
    description: `Screenshot: ${name}`,
    metadata: { screenshotName: filename, reason: name },
  });
  return filepath;
}

/** Take a screenshot and return it as a base64-encoded string for AI vision */
export async function screenshotToBase64(page: Page): Promise<string> {
  const buffer = await page.screenshot();
  return buffer.toString('base64');
}

// ── Navigation Helpers ───────────────────────────────

export async function navigateTo(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<Page> {
  const page = await getPage();
  await page.goto(url, {
    waitUntil: options?.waitUntil ?? 'domcontentloaded',
    timeout: 60_000,
  });
  return page;
}

/** Check if the current page is a login/redirect page (session expired) */
export async function isLoginPage(page: Page): Promise<boolean> {
  const url = page.url();
  return (
    url.includes('/login') ||
    url.includes('/d2l/login') ||
    url.includes('shibboleth') ||
    url.includes('/sso/') ||
    url.includes('auth.nyu.edu')
  );
}

// ── Active Page Helper ───────────────────────────────

/**
 * Return the current page if it exists and is not closed, otherwise null.
 * Does NOT create a new page or launch the browser.
 */
export function getActivePage(): Page | null {
  if (_page && !_page.isClosed()) return _page;
  return null;
}

// ── Cleanup ──────────────────────────────────────────

export async function closeBrowser(): Promise<void> {
  if (_page && !_page.isClosed()) {
    await _page.close();
    _page = null;
  }
  if (_context) {
    await _context.close();
    _context = null;
  }
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
  logger.info('Browser closed');
}

/** Get the raw cookies from the current browser context (for API client use) */
export async function getSessionCookies(): Promise<string> {
  if (!_context) return '';
  const cookies = await _context.cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Check if the browser is currently running.
 */
export function isBrowserActive(): boolean {
  return _browser !== null && _browser.isConnected();
}

/**
 * Get cookies for a specific domain (e.g., brightspace.nyu.edu)
 */
export async function getCookiesForDomain(domain: string): Promise<string> {
  if (!_context) return '';
  const cookies = await _context.cookies();
  return cookies
    .filter((c) => domain.includes(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
