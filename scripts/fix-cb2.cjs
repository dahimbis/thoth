const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

// Replace the checkbox section by finding it character by character
const marker = "field.type === 'checkbox' && !filled";
const idx = c.indexOf(marker);
if (idx === -1) { console.log('Not found'); process.exit(1); }

// Find the start of the if block (go back to find 'if')
const ifStart = c.lastIndexOf('if (', idx);
// Find the matching closing brace - count braces
let braceCount = 0;
let endIdx = idx;
let started = false;
for (let i = ifStart; i < c.length; i++) {
  if (c[i] === '{') { braceCount++; started = true; }
  if (c[i] === '}') { braceCount--; }
  if (started && braceCount === 0) { endIdx = i + 1; break; }
}

const oldBlock = c.substring(ifStart, endIdx);
console.log('Found block length:', oldBlock.length);

const newBlock = `if (field.type === 'checkbox' && !filled) {
        // Split by comma OR semicolon (AI uses both)
        const selections = field.proposedValue.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 2);
        logger.debug(\`[FILL] Checkbox: looking for \${selections.length} options\`);

        // Find question block by label text
        const cbLabel = field.label.substring(0, 40).replace(/["\\\\]/g, '');
        const cbBlock = page.locator(\`[role="listitem"]:has-text("\${cbLabel}"), .Qr7Oae:has-text("\${cbLabel}")\`).first();

        if (await cbBlock.isVisible({ timeout: 1000 }).catch(() => false)) {
          const opts = await cbBlock.$$('[role="checkbox"], .docssharedWizToggleLabeledContent, .nWQGrd, label');
          for (const opt of opts) {
            const text = await opt.textContent().catch(() => '');
            if (text && selections.some(s => text.trim().includes(s) || s.includes(text.trim().substring(0, 15)))) {
              await opt.scrollIntoViewIfNeeded();
              await opt.click();
              filled = true;
              await page.waitForTimeout(200);
            }
          }
        }

        // Fallback: all checkboxes on page
        if (!filled) {
          const allCb = await page.$$('[role="checkbox"], .docssharedWizToggleLabeledContent');
          for (const cb of allCb) {
            const text = await cb.textContent().catch(() => '');
            if (text && selections.some(s => text.trim().includes(s) || s.includes(text.trim().substring(0, 15)))) {
              await cb.scrollIntoViewIfNeeded();
              await cb.click();
              filled = true;
              await page.waitForTimeout(200);
            }
          }
        }
      }`;

c = c.substring(0, ifStart) + newBlock + c.substring(endIdx);
fs.writeFileSync('src/browser/pages/google-forms.ts', c);
console.log('Checkbox logic replaced successfully');
