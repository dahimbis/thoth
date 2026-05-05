const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

const old = `if (field.type === 'checkbox' && !filled) {
        const selections = field.proposedValue.split(',').map(s => s.trim());
        const allChecks = await page.$$('[role="checkbox"], .docssharedWizToggleLabeledContent');
        for (const check of allChecks) {
          const text = await check.textContent().catch(() => '');
          if (text && selections.some(s => text.trim().includes(s))) {
            await check.click();
            filled = true;
          }
        }
      }`;

const replacement = `if (field.type === 'checkbox' && !filled) {
        // Split by comma OR semicolon
        const selections = field.proposedValue.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 2);
        logger.debug(\`[FILL] Checkbox: looking for \${selections.length} options\`);

        // Find question block by label, then click checkboxes inside
        const labelShort = field.label.substring(0, 40).replace(/["\\\\]/g, '');
        const qBlock = page.locator(\`[role="listitem"]:has-text("\${labelShort}"), .Qr7Oae:has-text("\${labelShort}")\`).first();

        if (await qBlock.isVisible({ timeout: 1000 }).catch(() => false)) {
          const opts = await qBlock.$$('[role="checkbox"], .docssharedWizToggleLabeledContent, .nWQGrd, label');
          for (const opt of opts) {
            const text = await opt.textContent().catch(() => '');
            if (text && selections.some(s => text.trim().includes(s) || s.includes(text.trim().substring(0, 20)))) {
              await opt.scrollIntoViewIfNeeded();
              await opt.click();
              filled = true;
              await page.waitForTimeout(200);
            }
          }
        }

        // Fallback: click all matching checkboxes on page
        if (!filled) {
          const allChecks = await page.$$('[role="checkbox"], .docssharedWizToggleLabeledContent');
          for (const check of allChecks) {
            const text = await check.textContent().catch(() => '');
            if (text && selections.some(s => text.trim().includes(s) || s.includes(text.trim().substring(0, 20)))) {
              await check.scrollIntoViewIfNeeded();
              await check.click();
              filled = true;
              await page.waitForTimeout(200);
            }
          }
        }
      }`;

if (c.includes(old)) {
  c = c.replace(old, replacement);
  console.log('Fixed checkbox logic');
} else {
  // Try with page.$ instead of page.$$
  const oldSingle = old.replace("page.$$('[role", "page.$('[role");
  if (c.includes(oldSingle)) {
    c = c.replace(oldSingle, replacement);
    console.log('Fixed checkbox logic (was page.$)');
  } else {
    console.log('Could not find checkbox section');
    const idx = c.indexOf("field.type === 'checkbox'");
    if (idx > -1) console.log('Found at:', idx, c.substring(idx, idx + 100));
  }
}

fs.writeFileSync('src/browser/pages/google-forms.ts', c);
