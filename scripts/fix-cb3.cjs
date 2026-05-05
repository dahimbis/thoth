const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

// Fix: cbBlock.$$() doesn't work on Locators. Use locator().all() pattern
c = c.replace(
  /const opts = await cbBlock\.\$\$?\('[^']+'\);/,
  `const optsCount = await cbBlock.locator('[role="checkbox"], .docssharedWizToggleLabeledContent, .nWQGrd, label').count();
          const optsLocator = cbBlock.locator('[role="checkbox"], .docssharedWizToggleLabeledContent, .nWQGrd, label');`
);

// Fix the for loop to use count-based iteration
c = c.replace(
  /for \(const opt of opts\) \{\s*\n\s*const text = await opt\.textContent/,
  `for (let oi = 0; oi < optsCount; oi++) {
            const opt = optsLocator.nth(oi);
            const text = await opt.textContent`
);

fs.writeFileSync('src/browser/pages/google-forms.ts', c);
console.log('Fixed cbBlock.$$ to use locator pattern');
