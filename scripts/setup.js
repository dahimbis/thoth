#!/usr/bin/env node

/**
 * First-time setup script.
 * - Creates .env from .env.example if it doesn't exist
 * - Creates required data directories
 * - Checks if Playwright browsers are installed
 */

import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 1. Create .env
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');

if (!existsSync(envPath) && existsSync(examplePath)) {
  copyFileSync(examplePath, envPath);
  console.log('  Created .env from .env.example');
  console.log('  >> Open .env and fill in your credentials before running.');
} else if (existsSync(envPath)) {
  console.log('  .env already exists');
}

// 2. Create directories
for (const dir of ['data', 'outputs', 'screenshots']) {
  const dirPath = resolve(root, dir);
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    console.log(`  Created ${dir}/`);
  }
}

// 3. Check Playwright
try {
  const result = execSync('npx playwright --version', { encoding: 'utf-8', timeout: 10000 });
  console.log(`  Playwright: ${result.trim()}`);
} catch {
  console.log('  Playwright browsers not installed.');
  console.log('  >> Run: npx playwright install chromium');
}

console.log('');
console.log('  Setup complete. Next steps:');
console.log('  1. Edit .env with your credentials');
console.log('  2. npm run build');
console.log('  3. npm start');
console.log('');
