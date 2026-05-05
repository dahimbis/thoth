const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

// Replace the fillGoogleForm function with a label-based approach
const oldStart = `/**
 * Fill a Google Form with the proposed values.
 * Call this AFTER user confirms the preview.
 */
export async function fillGoogleForm(`;

const oldStart2 = `/**
 * Fill a Google Form with the proposed values.
 * Uses label-based field matching for reliability.
 * Call this AFTER user confirms the preview.
 */
export async function fillGoogleForm(`;

const marker = 'Call this AFTER user confirms the preview.';
const startIdx = c.indexOf(marker);
const realStart = c.lastIndexOf('/**', startIdx);

// Find the end of the function - look for the screenshot line
const screenshotLine = `  const screenshotPath = await takeScreenshot(page, 'google-form-filled');`;
const endIdx = c.indexOf(screenshotLine, startIdx);

if (startIdx === -1 || endIdx === -1 || realStart === -1) {
  console.log('Could not find function boundaries. Start:', realStart, 'Marker:', startIdx, 'End:', endIdx);
  process.exit(1);
}

const newFunction = `/**
 * Fill a Google Form with the proposed values.
 * Uses label-based field matching for reliability.
 */
export async function fillGoogleForm(
  url: string,
  fields: FormField[],
): Promise<{ success: boolean; screenshotPath: string }> {
  const { getPage: getBrowserPage } = await import('../browser.js');
  const page = await getBrowserPage();
  await page.waitForTimeout(1000);

  logger.info(\`[FILL] Starting to fill \${fields.length} fields on: \${page.url()}\`);

  let filledCount = 0;
  let failedCount = 0;

  for (const field of fields) {
    if (!field.proposedValue || field.proposedValue.trim() === '') {
      continue;
    }

    try {
      logger.info(\`[FILL] Field "\${field.label}" (\${field.type}) -> "\${field.proposedValue.substring(0, 50)}"\`);

      let filled = false;

      if (field.type === 'short-text' || field.type === 'long-text' || field.type === 'unknown') {
        // Find all text inputs and textareas on the page
        const allInputs = await page.$$('input[type="text"], input:not([type]), textarea');
        logger.debug(\`[FILL] Found \${allInputs.length} text inputs on page\`);

        // Try to match by looking at parent container text
        for (const input of allInputs) {
          try {
            const containerText = await input.evaluate((el) => {
              let node = el.parentElement;
              for (let i = 0; i < 6 && node; i++) {
                if (node.textContent && node.textContent.includes(el.getAttribute('aria-label') || '')) return node.textContent;
                node = node.parentElement;
              }
              return el.closest('[role="listitem"], .Qr7Oae, .geS5n')?.textContent || '';
            });
            if (containerText.includes(field.label)) {
              await input.fill(field.proposedValue);
              filled = true;
              break;
            }
          } catch { /* skip this input */ }
        }

        // Fallback: use aria-label matching
        if (!filled) {
          const byLabel = page.locator(\`input[aria-label*="\${field.label.substring(0, 30)}"], textarea[aria-label*="\${field.label.substring(0, 30)}"]\`).first();
          if (await byLabel.isVisible({ timeout: 1000 }).catch(() => false)) {
            await byLabel.fill(field.proposedValue);
            filled = true;
          }
        }

        // Last fallback: nth input
        if (!filled && allInputs[field.index]) {
          await allInputs[field.index].fill(field.proposedValue);
          filled = true;
        }
      }

      if (field.type === 'radio' && !filled) {
        // Click the radio option matching the value
        const radioOption = page.locator(\`[data-value="\${field.proposedValue}"], [role="radio"]:has-text("\${field.proposedValue}")\`).first();
        if (await radioOption.isVisible({ timeout: 1000 }).catch(() => false)) {
          await radioOption.click();
          filled = true;
        } else {
          // Try clicking by text content
          const allRadios = await page.$$('[role="radio"], .docssharedWizToggleLabeledContent, .nWQGrd');
          for (const radio of allRadios) {
            const text = await radio.textContent().catch(() => '');
            if (text && text.trim() === field.proposedValue.trim()) {
              await radio.click();
              filled = true;
              break;
            }
          }
        }
      }

      if (field.type === 'checkbox' && !filled) {
        const selections = field.proposedValue.split(',').map(s => s.trim());
        const allChecks = await page.$$('[role="checkbox"], .docssharedWizToggleLabeledContent');
        for (const check of allChecks) {
          const text = await check.textContent().catch(() => '');
          if (text && selections.some(s => text.trim().includes(s))) {
            await check.click();
            filled = true;
          }
        }
      }

      if (field.type === 'dropdown' && !filled) {
        const dropdown = await page.$('[role="listbox"], select');
        if (dropdown) {
          await dropdown.click();
          await page.waitForTimeout(500);
          const option = page.locator(\`[role="option"]:has-text("\${field.proposedValue}")\`).first();
          if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
            await option.click();
            filled = true;
          }
        }
      }

      if (filled) {
        filledCount++;
        logger.info(\`[FILL] OK: "\${field.label}"\`);
      } else {
        failedCount++;
        logger.warn(\`[FILL] FAILED: "\${field.label}" (\${field.type}) - could not find matching element\`);
      }
    } catch (err) {
      failedCount++;
      logger.error(\`[FILL] ERROR: "\${field.label}" - \${err}\`);
    }

    await page.waitForTimeout(300);
  }

  logger.info(\`[FILL] Complete: \${filledCount} filled, \${failedCount} failed\`);

`;

c = c.substring(0, realStart) + newFunction + c.substring(endIdx);
fs.writeFileSync('src/browser/pages/google-forms.ts', c);
console.log('Done - rewrote fillGoogleForm with label-based matching and logging');
