import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyExtensionToDesktop, getDesktopExtensionPath } from './copy-to-desktop.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const loadPath = resolve(root, 'formvault-extension');

for (const legacy of ['_LOAD_IN_CHROME_', 'extension', 'dist']) {
  const legacyPath = resolve(root, legacy);
  if (existsSync(legacyPath)) {
    rmSync(legacyPath, { recursive: true, force: true });
    console.log(`Removed legacy folder: ${legacy}/`);
  }
}

if (!existsSync(loadPath)) {
  console.error('formvault-extension/ folder not found. Run npm run build first.');
  process.exit(1);
}

if (!existsSync(resolve(loadPath, 'manifest.json'))) {
  console.error('formvault-extension/manifest.json is missing. Build may have failed.');
  process.exit(1);
}

let desktopPath;
try {
  desktopPath = copyExtensionToDesktop();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

writeFileSync(
  resolve(root, 'READ-ME-FIRST.txt'),
  [
    'DO NOT load this "paapi" folder in Chrome.',
    '',
    'Use the folder on your DESKTOP instead:',
    '',
    `  ${desktopPath}`,
    '',
    'Run install-chrome-extension.bat to build and open it.',
    '',
  ].join('\r\n'),
  'utf8',
);

console.log('');
console.log('Build complete.');
console.log('');
console.log('Load THIS folder in Chrome (chrome://extensions → Load unpacked):');
console.log('');
console.log(`  ${desktopPath}`);
console.log('');
console.log('(Copied to your Desktop — NOT the paapi folder)');
console.log('');
