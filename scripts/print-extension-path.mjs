import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { getDesktopExtensionPath } from './copy-to-desktop.mjs';

const desktopPath = getDesktopExtensionPath();

console.log('');
console.log('FormVault AI is ready for Chrome.');
console.log('');

if (!existsSync(`${desktopPath}/manifest.json`)) {
  console.log('ERROR: Desktop extension folder not found.');
  console.log('Run: npm run build');
  process.exit(1);
}

console.log('In chrome://extensions → Load unpacked → select:');
console.log('');
console.log(`   ${desktopPath}`);
console.log('');
console.log('This folder is on your DESKTOP.');
console.log('Do NOT select the paapi project folder.');
console.log('');

try {
  if (process.platform === 'win32') {
    execSync(`explorer "${desktopPath}"`, { stdio: 'ignore' });
  }
} catch {
  // Non-fatal
}

console.log('');
