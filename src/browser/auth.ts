import { type Page } from 'playwright';
import { TOTP } from 'otpauth';
import { getConfig } from '../config.js';
import {
  getPage,
  saveSession,
  takeScreenshot,
  isLoginPage,
  navigateTo,
  loadSession,
  isSessionExpired,
  getContext,
} from './browser.js';
import { logger } from '../ui/logger.js';
import { logAction } from '../db/queries.js';

const MAX_LOGIN_RETRIES = 3;

/**
 * Authenticate with Brightspace.
 * 1. Try loading saved session cookies
 * 2. Verify session by navigating to home
 * 3. If expired, perform full login flow
 */
export async function authenticate(): Promise<Page> {
  const config = getConfig();
  const homeUrl = `${config.BRIGHTSPACE_BASE_URL}/d2l/home`;

  // Step 1: Try existing session
  if (!isSessionExpired()) {
    logger.info('Attempting to use saved session');
    const page = await navigateTo(homeUrl);

    // Give the page a moment to redirect if session is invalid
    await page.waitForLoadState('domcontentloaded');

    if (!(await isLoginPage(page))) {
      logger.success('Session is valid');
      logAction(null, 'auth_session_restored', 'Using saved session cookies');
      return page;
    }

    logger.warn('Saved session expired, performing fresh login');
  }

  // Step 2: Full login flow
  return performLogin();
}

/**
 * Perform the full browser-based login flow.
 * Handles:
 * - NYU Shibboleth/SSO redirects
 * - Username/password entry
 * - 2FA (TOTP) if configured
 */
async function performLogin(): Promise<Page> {
  const config = getConfig();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_LOGIN_RETRIES; attempt++) {
    try {
      logger.info(`Login attempt ${attempt}/${MAX_LOGIN_RETRIES}`);

      const page = await navigateTo(`${config.BRIGHTSPACE_BASE_URL}/d2l/login`, {
        waitUntil: 'networkidle',
      });

      await takeScreenshot(page, 'login-page');

      // Wait for the page to settle — NYU may redirect to Shibboleth
      await page.waitForLoadState('networkidle');

      // Detect the login form and fill credentials
      await fillLoginCredentials(page, config.BRIGHTSPACE_USERNAME, config.BRIGHTSPACE_PASSWORD);

      // Wait for potential 2FA prompt or successful redirect
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000); // Allow redirects to complete

      // Handle 2FA if present
      if (config.BRIGHTSPACE_TOTP_SECRET) {
        await handle2FA(page, config.BRIGHTSPACE_TOTP_SECRET);
      }

      // Wait for final redirect to Brightspace home
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Verify login succeeded
      if (await isLoginPage(page)) {
        // Check for error messages
        const errorText = await page.locator('[class*="error"], [class*="alert"], .form-error')
          .textContent()
          .catch(() => null);

        if (errorText) {
          throw new Error(`Login failed: ${errorText.trim()}`);
        }
        throw new Error('Login failed: still on login page after submitting credentials');
      }

      // Success
      await saveSession();
      await takeScreenshot(page, 'login-success');
      logger.success('Login successful');
      logAction(null, 'auth_login', `Login successful on attempt ${attempt}`);

      return page;
    } catch (err) {
      lastError = err as Error;
      logger.error(`Login attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < MAX_LOGIN_RETRIES) {
        logger.info('Retrying in 5 seconds...');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  throw new Error(`Authentication failed after ${MAX_LOGIN_RETRIES} attempts: ${lastError?.message}`);
}

/**
 * Fill in login credentials.
 * Handles multiple possible login form layouts:
 * - Direct Brightspace login
 * - NYU Shibboleth/CAS SSO
 * - Generic forms
 */
async function fillLoginCredentials(page: Page, username: string, password: string): Promise<void> {
  // Strategy: Try multiple selectors, use the first that works

  const usernameSelectors = [
    '#username',          // NYU Shibboleth
    '#userName',          // Brightspace native
    '#loginForm_username', // Alternative
    'input[name="username"]',
    'input[name="userName"]',
    'input[name="j_username"]', // CAS
    'input[type="text"][id*="user"]',
    'input[type="email"]',
  ];

  const passwordSelectors = [
    '#password',
    '#loginForm_password',
    'input[name="password"]',
    'input[name="j_password"]',
    'input[type="password"]',
  ];

  // Find and fill username
  let usernameFilled = false;
  for (const selector of usernameSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.fill(username);
        usernameFilled = true;
        logger.debug(`Username filled via selector: ${selector}`);
        break;
      }
    } catch {
      // Try next selector
    }
  }

  if (!usernameFilled) {
    throw new Error('Could not find username field on login page');
  }

  // Find and fill password
  let passwordFilled = false;
  for (const selector of passwordSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.fill(password);
        passwordFilled = true;
        logger.debug(`Password filled via selector: ${selector}`);
        break;
      }
    } catch {
      // Try next selector
    }
  }

  if (!passwordFilled) {
    throw new Error('Could not find password field on login page');
  }

  // Submit the form
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    '#submitButton',
    '.login-button',
    'button:has-text("Log In")',
    'button:has-text("Sign In")',
    'button:has-text("Login")',
  ];

  for (const selector of submitSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click();
        logger.debug(`Login form submitted via: ${selector}`);
        return;
      }
    } catch {
      // Try next
    }
  }

  // Fallback: press Enter
  await page.keyboard.press('Enter');
  logger.debug('Login form submitted via Enter key');
}

/**
 * Handle 2FA (TOTP) challenge.
 */
async function handle2FA(page: Page, totpSecret: string): Promise<void> {
  // Check if 2FA form is present
  const otpSelectors = [
    'input[name="otp"]',
    'input[name="totp"]',
    'input[name="passcode"]',
    'input[name="verificationCode"]',
    'input[id*="otp"]',
    'input[id*="mfa"]',
    'input[placeholder*="code"]',
    'input[type="tel"]', // Some 2FA forms use tel type
  ];

  let otpField = null;
  for (const selector of otpSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 3000 })) {
        otpField = el;
        break;
      }
    } catch {
      // Try next
    }
  }

  if (!otpField) {
    logger.debug('No 2FA prompt detected, skipping');
    return;
  }

  // Generate TOTP code
  const totp = new TOTP({
    secret: totpSecret,
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  });
  const code = totp.generate();

  await otpField.fill(code);
  logger.info(`2FA code entered: ${code.substring(0, 2)}****`);

  // Submit 2FA
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Verify")',
    'button:has-text("Submit")',
    'button:has-text("Continue")',
  ];

  for (const selector of submitSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click();
        return;
      }
    } catch {
      // Try next
    }
  }

  await page.keyboard.press('Enter');
}

/**
 * Re-authenticate silently when session expires mid-task.
 * This is called by error recovery code.
 */
export async function reAuthenticate(): Promise<Page> {
  logger.warn('Session expired mid-task, re-authenticating...');
  logAction(null, 'auth_reauth', 'Session expired, performing silent re-authentication');
  return performLogin();
}
