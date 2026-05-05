const fs = require('fs');
let c = fs.readFileSync('src/browser/pages/google-forms.ts', 'utf8');

// Find the text field filling block and replace with simpler sequential logic
const oldBlock = `      if (field.type === 'short-text' || field.type === 'long-text' || field.type === 'unknown') {
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
          await allInputs[field.index]!.fill(field.proposedValue);
          filled = true;
        }
      }`;

const newBlock = `      if (field.type === 'short-text' || field.type === 'long-text' || field.type === 'unknown') {
        // Strategy: find all visible, empty text inputs/textareas and fill the next available one
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
        }
      }`;

if (c.includes(oldBlock)) {
  c = c.replace(oldBlock, newBlock);
  console.log('Replaced text field filling logic');
} else {
  console.log('Could not find old block - trying partial match');
  // Try a simpler replacement
  const simpleOld = "// Find all text inputs and textareas on the page";
  const simpleIdx = c.indexOf(simpleOld);
  if (simpleIdx !== -1) {
    // Find the closing of this if block
    const blockStart = c.lastIndexOf("if (field.type === 'short-text'", simpleIdx);
    // Find the matching closing brace - look for the next "if (field.type === 'radio'" 
    const nextBlock = c.indexOf("if (field.type === 'radio'", simpleIdx);
    if (blockStart !== -1 && nextBlock !== -1) {
      // Replace from blockStart to just before nextBlock
      const beforeBlock = c.substring(0, blockStart);
      const afterBlock = c.substring(nextBlock);
      c = beforeBlock + newBlock + '\n\n      ' + afterBlock;
      console.log('Replaced using partial match');
    } else {
      console.log('Could not find block boundaries. blockStart:', blockStart, 'nextBlock:', nextBlock);
    }
  } else {
    console.log('Could not find any match');
  }
}

fs.writeFileSync('src/browser/pages/google-forms.ts', c);
