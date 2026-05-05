const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

// Fix the single-element selector that should be array
const old = 'const allInputs = await page.$(selector);';
const fixed = 'const allInputs = await page.$$(selector);';

if (c.includes(old)) {
  c = c.replace(old, fixed);
  console.log('Fixed: page.$(selector) -> page.$$(selector)');
} else if (c.includes(fixed)) {
  console.log('Already fixed');
} else {
  console.log('Could not find the line to fix');
  // Show what's actually there
  const idx = c.indexOf('allInputs = await page.');
  if (idx > -1) {
    console.log('Found at:', idx, c.substring(idx, idx + 60));
  }
}

fs.writeFileSync('src/browser/pages/google-forms.ts', c);
