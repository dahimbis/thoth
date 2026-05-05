const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

// Fix: in the fill function, the text input finding uses page.$() which returns single element
// Replace with page.$$() which returns array
// But only the ones inside the fill function that iterate over results

// The specific problematic line:
// const allInputs = await page.$('input[type="text"], input:not([type]), textarea');
c = c.replace(
  /const allInputs = await page\.\$\('input\[type="text"\], input:not\(\[type\]\), textarea'\)/g,
  'const allInputs = await page.$$(`input[type="text"], input:not([type]), textarea`)'
);

// Also fix: await page.$('[role="listbox"], select')
// This one is fine as single element (we want one dropdown)

// The real fix: rewrite the text field filling to use a simpler sequential approach
// Find the text fill section and replace it

const oldTextFill = `      if (field.type === 'short-text' || field.type === 'long-text' || field.type === 'unknown') {
        // Find all text inputs and textareas on the page
        const allInputs = await page.$$(\`input[type="text"], input:not([type]), textarea\`);
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
          await allInputs[field.index]!.fill(field.proposedValue);
          filled = true;
        }`;

const newTextFill = `      if (field.type === 'short-text' || field.type === 'long-text' || field.type === 'unknown') {
        // Strategy: find ALL empty text inputs/textareas, try to match by parent text
        const allInputs = await page.$$('input[type="text"], input:not([type]), textarea');
        logger.debug(\`[FILL] Found \${allInputs.length} text inputs on page\`);

        // First try: find input whose parent container mentions the field label
        for (const input of allInputs) {
          try {
            const info = await input.evaluate((el) => {
              const container = el.closest('[role="listitem"], .Qr7Oae, .geS5n, [class*="freebirdFormviewerComponentsQuestionBase"]');
              return {
                text: container?.textContent || '',
                isEmpty: !(el as HTMLInputElement).value,
                tag: el.tagName.toLowerCase(),
              };
            });
            if (info.text.includes(field.label) && info.isEmpty) {
              await input.fill(field.proposedValue);
              filled = true;
              break;
            }
          } catch { /* skip */ }
        }

        // Second try: use Playwright locator with text matching
        if (!filled) {
          try {
            // Find the question container by its text, then find the input inside it
            const container = page.locator(\`[role="listitem"]:has-text("\${field.label.substring(0, 40)}"), .Qr7Oae:has-text("\${field.label.substring(0, 40)}")\`).first();
            if (await container.isVisible({ timeout: 500 }).catch(() => false)) {
              const input = container.locator('input[type="text"], input:not([type]), textarea').first();
              if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
                await input.fill(field.proposedValue);
                filled = true;
              }
            }
          } catch { /* skip */ }
        }

        // Third try: find any empty input and fill it (sequential order)
        if (!filled) {
          for (const input of allInputs) {
            try {
              const isEmpty = await input.evaluate((el) => !(el as HTMLInputElement).value);
              if (isEmpty) {
                await input.fill(field.proposedValue);
                filled = true;
                break;
              }
            } catch { /* skip */ }
          }
        }`;

if (c.includes(oldTextFill)) {
  c = c.replace(oldTextFill, newTextFill);
  console.log('Replaced text fill logic with improved version');
} else {
  console.log('Could not find old text fill logic - trying partial match');
  // Try a simpler replacement
  const simpleOld = "const allInputs = await page.$$(`input[type=\"text\"], input:not([type]), textarea`)";
  const simpleNew = "const allInputs = await page.$$('input[type=\"text\"], input:not([type]), textarea')";
  if (c.includes(simpleOld)) {
    c = c.replace(simpleOld, simpleNew);
    console.log('Fixed template literal in selector');
  }
}

fs.writeFileSync('src/browser/pages/google-forms.ts', c);
console.log('Done');
