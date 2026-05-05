const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

// Find the text fill section and replace with Playwright locator approach
const oldSection = `        // Strategy: find all visible, empty text inputs/textareas and fill the next available one
        const selector = field.type === 'long-text' ? 'textarea' : 'input[type="text"], input:not([type])';
        const allInputs = await page.$$(selector);

        // First try: find input whose container includes the field label
        for (const input of allInputs) {
          try {
            const isMatch = await input.evaluate((el, label) => {
              const container = el.closest('.Qr7Oae, .geS5n, [role="listitem"]') || el.parentElement?.parentElement?.parentElement;
              return container?.textContent?.includes(label) || false;
            }, field.label);
            if (isMatch) {
              await input.scrollIntoViewIfNeeded();
              await input.fill(field.proposedValue);
              filled = true;
              break;
            }
          } catch { /* skip */ }
        }

        // Second try: find any empty input and fill it (sequential)
        if (!filled) {
          for (const input of allInputs) {
            try {
              const isEmpty = await input.evaluate(el => !(el as HTMLInputElement).value);
              if (isEmpty) {
                await input.scrollIntoViewIfNeeded();
                await input.fill(field.proposedValue);
                filled = true;
                break;
              }
            } catch { /* skip */ }
          }
        }`;

const newSection = `        // Use Playwright locators for reliable element finding
        // Strategy 1: Find the question block by label text, then find input inside it
        const labelShort = field.label.substring(0, 50).replace(/[\"\\\\]/g, '');
        const questionBlock = page.locator(\`.Qr7Oae:has-text("\${labelShort}"), .geS5n:has-text("\${labelShort}"), [role="listitem"]:has-text("\${labelShort}")\`).first();

        if (await questionBlock.isVisible({ timeout: 1000 }).catch(() => false)) {
          const inputSelector = field.type === 'long-text' ? 'textarea' : 'input[type="text"], input:not([type])';
          const input = questionBlock.locator(inputSelector).first();
          if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
            await input.scrollIntoViewIfNeeded();
            await input.fill(field.proposedValue);
            filled = true;
          }
        }

        // Strategy 2: Try aria-label
        if (!filled) {
          const ariaInput = page.locator(\`input[aria-label*="\${labelShort}"], textarea[aria-label*="\${labelShort}"]\`).first();
          if (await ariaInput.isVisible({ timeout: 500 }).catch(() => false)) {
            await ariaInput.scrollIntoViewIfNeeded();
            await ariaInput.fill(field.proposedValue);
            filled = true;
          }
        }

        // Strategy 3: Find all empty inputs and fill the next one in order
        if (!filled) {
          const allInputs = await page.$$('input[type="text"]:not([aria-hidden="true"]), textarea:not([aria-hidden="true"])');
          for (const input of allInputs) {
            try {
              const isEmpty = await input.evaluate(el => !(el as HTMLInputElement).value && (el as HTMLElement).offsetParent !== null);
              if (isEmpty) {
                await input.scrollIntoViewIfNeeded();
                await input.fill(field.proposedValue);
                filled = true;
                break;
              }
            } catch { /* skip */ }
          }
        }`;

if (c.includes(oldSection)) {
  c = c.replace(oldSection, newSection);
  console.log('SUCCESS: Replaced text fill logic with Playwright locator approach');
} else {
  console.log('ERROR: Could not find the old section to replace');
  // Debug: show what's around the selector line
  const idx = c.indexOf('Strategy: find all visible');
  if (idx > -1) {
    console.log('Found strategy at:', idx);
    console.log(c.substring(idx, idx + 200));
  } else {
    console.log('Strategy text not found either');
  }
}

fs.writeFileSync('src/browser/pages/google-forms.ts', c);
