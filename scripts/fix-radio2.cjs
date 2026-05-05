const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

const marker = "field.type === 'radio' && !filled";
const idx = c.indexOf(marker);
if (idx === -1) { console.log('Not found'); process.exit(1); }

const ifStart = c.lastIndexOf('if (', idx);
let braceCount = 0, endIdx = idx, started = false;
for (let i = ifStart; i < c.length; i++) {
  if (c[i] === '{') { braceCount++; started = true; }
  if (c[i] === '}') { braceCount--; }
  if (started && braceCount === 0) { endIdx = i + 1; break; }
}

console.log('Old block length:', endIdx - ifStart);

const newBlock = `if (field.type === 'radio' && !filled) {
        const radioLabel = field.label.substring(0, 40).replace(/["\\\\]/g, '');
        const radioValue = field.proposedValue.trim();

        // Find question block, then click matching radio inside it
        const radioBlock = page.locator(\`[role="listitem"]:has-text("\${radioLabel}"), .Qr7Oae:has-text("\${radioLabel}")\`).first();
        if (await radioBlock.isVisible({ timeout: 1000 }).catch(() => false)) {
          // Try exact data-value match
          const exactMatch = radioBlock.locator(\`[data-value="\${radioValue}"]\`).first();
          if (await exactMatch.isVisible({ timeout: 500 }).catch(() => false)) {
            await exactMatch.scrollIntoViewIfNeeded();
            await exactMatch.click();
            filled = true;
          }
          // Try text match
          if (!filled) {
            const textMatch = radioBlock.locator(\`[role="radio"]:has-text("\${radioValue}"), .docssharedWizToggleLabeledContent:has-text("\${radioValue}")\`).first();
            if (await textMatch.isVisible({ timeout: 500 }).catch(() => false)) {
              await textMatch.scrollIntoViewIfNeeded();
              await textMatch.click();
              filled = true;
            }
          }
          // Try partial match (first significant word)
          if (!filled && radioValue.length > 3) {
            const partial = radioValue.substring(0, 15);
            const partialMatch = radioBlock.locator(\`[role="radio"]:has-text("\${partial}"), .docssharedWizToggleLabeledContent:has-text("\${partial}")\`).first();
            if (await partialMatch.isVisible({ timeout: 500 }).catch(() => false)) {
              await partialMatch.scrollIntoViewIfNeeded();
              await partialMatch.click();
              filled = true;
            }
          }
          // Last resort: click first unselected radio (for grid/matching questions)
          if (!filled) {
            const unselected = radioBlock.locator('[role="radio"][aria-checked="false"]').first();
            if (await unselected.isVisible({ timeout: 500 }).catch(() => false)) {
              await unselected.scrollIntoViewIfNeeded();
              await unselected.click();
              filled = true;
              logger.debug(\`[FILL] Fallback: clicked first unselected radio for grid question\`);
            }
          }
        }

        // Page-wide fallback
        if (!filled) {
          const pageRadio = page.locator(\`[data-value="\${radioValue}"], [role="radio"]:has-text("\${radioValue}")\`).first();
          if (await pageRadio.isVisible({ timeout: 500 }).catch(() => false)) {
            await pageRadio.scrollIntoViewIfNeeded();
            await pageRadio.click();
            filled = true;
          }
        }
      }`;

c = c.substring(0, ifStart) + newBlock + c.substring(endIdx);
fs.writeFileSync('src/browser/pages/google-forms.ts', c);
console.log('Radio logic replaced');
