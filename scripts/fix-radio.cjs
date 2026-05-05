const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

const oldRadio = `if (field.type === 'radio' && !filled) {
        // Click the radio option matching the value
        const radioOption = page.locator(\`[data-value="\${field.proposedValue}"], [role="radio"]:has-text("\${field.proposedValue}")\`).first();
        if (await radioOption.isVisible({ timeout: 1000 }).catch(() => false)) {
          await radioOption.click();
          filled = true;
        } else {
          // Try clicking by text content
          const allRadios = await page.$('[role="radio"], .docssharedWizToggleLabeledContent, .nWQGrd');
          for (const radio of allRadios) {
            const text = await radio.textContent().catch(() => '');
            if (text && text.trim() === field.proposedValue.trim()) {
              await radio.click();
              filled = true;
              break;
            }
          }
        }
      }`;

const newRadio = `if (field.type === 'radio' && !filled) {
        const radioLabel = field.label.substring(0, 40).replace(/["\\\\]/g, '');
        const radioValue = field.proposedValue.trim();

        // Strategy 1: Find question block, then click matching radio inside it
        const radioBlock = page.locator(\`[role="listitem"]:has-text("\${radioLabel}"), .Qr7Oae:has-text("\${radioLabel}")\`).first();
        if (await radioBlock.isVisible({ timeout: 1000 }).catch(() => false)) {
          // Try exact data-value match
          const exactMatch = radioBlock.locator(\`[data-value="\${radioValue}"]\`).first();
          if (await exactMatch.isVisible({ timeout: 500 }).catch(() => false)) {
            await exactMatch.scrollIntoViewIfNeeded();
            await exactMatch.click();
            filled = true;
          }
          // Try text match within the block
          if (!filled) {
            const radioInBlock = radioBlock.locator(\`[role="radio"]:has-text("\${radioValue}"), .docssharedWizToggleLabeledContent:has-text("\${radioValue}")\`).first();
            if (await radioInBlock.isVisible({ timeout: 500 }).catch(() => false)) {
              await radioInBlock.scrollIntoViewIfNeeded();
              await radioInBlock.click();
              filled = true;
            }
          }
          // Try partial match (first word)
          if (!filled) {
            const firstWord = radioValue.split(' ')[0];
            if (firstWord && firstWord.length > 2) {
              const partial = radioBlock.locator(\`[role="radio"]:has-text("\${firstWord}"), .docssharedWizToggleLabeledContent:has-text("\${firstWord}")\`).first();
              if (await partial.isVisible({ timeout: 500 }).catch(() => false)) {
                await partial.scrollIntoViewIfNeeded();
                await partial.click();
                filled = true;
              }
            }
          }
        }

        // Strategy 2: Page-wide search
        if (!filled) {
          const pageRadio = page.locator(\`[data-value="\${radioValue}"], [role="radio"]:has-text("\${radioValue}")\`).first();
          if (await pageRadio.isVisible({ timeout: 500 }).catch(() => false)) {
            await pageRadio.scrollIntoViewIfNeeded();
            await pageRadio.click();
            filled = true;
          }
        }

        // Strategy 3: For grid/matching questions - just click the first unselected radio in the question block
        if (!filled && radioBlock && await radioBlock.isVisible({ timeout: 200 }).catch(() => false)) {
          const unselected = radioBlock.locator('[role="radio"][aria-checked="false"]').first();
          if (await unselected.isVisible({ timeout: 500 }).catch(() => false)) {
            await unselected.scrollIntoViewIfNeeded();
            await unselected.click();
            filled = true;
            logger.debug(\`[FILL] Used fallback: clicked first unselected radio for "\${field.label}"\`);
          }
        }
      }`;

if (c.includes(oldRadio)) {
  c = c.replace(oldRadio, newRadio);
  console.log('Radio logic replaced with improved version');
} else {
  console.log('Could not find old radio logic');
  const idx = c.indexOf("field.type === 'radio' && !filled");
  if (idx > -1) console.log('Found at:', idx);
}

fs.writeFileSync('src/browser/pages/google-forms.ts', c);
