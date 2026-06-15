import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const source = resolve(root, 'formvault-extension');
const desktopPath = resolve(homedir(), 'Desktop', 'FormVaultAI-Load-In-Chrome');

export function getDesktopExtensionPath() {
  return desktopPath;
}

export function copyExtensionToDesktop() {
  if (!existsSync(resolve(source, 'manifest.json'))) {
    throw new Error('Build output missing. Run npm run build first.');
  }

  if (existsSync(desktopPath)) {
    rmSync(desktopPath, { recursive: true, force: true });
  }

  cpSync(source, desktopPath, { recursive: true });

  writeFileSync(
    resolve(desktopPath, 'LOAD-THIS-FOLDER-IN-CHROME.txt'),
    [
      'FormVault AI',
      '============',
      '',
      'In Chrome: chrome://extensions',
      '→ Developer mode ON',
      '→ Load unpacked',
      '→ Select THIS folder (FormVaultAI-Load-In-Chrome on your Desktop)',
      '',
      `Path: ${desktopPath}`,
      '',
      'This folder has manifest.json. The paapi project folder does NOT.',
      '',
    ].join('\r\n'),
    'utf8',
  );

  return desktopPath;
}

// Run directly: node scripts/copy-to-desktop.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = copyExtensionToDesktop();
  console.log(`Extension copied to Desktop:\n${path}`);
}
