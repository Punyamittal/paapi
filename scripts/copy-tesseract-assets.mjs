import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public', 'tesseract');

const copies = [
  [join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core.wasm.js'), 'tesseract-core.wasm.js'],
  [join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core.wasm'), 'tesseract-core.wasm'],
  [join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-simd.wasm.js'), 'tesseract-core-simd.wasm.js'],
  [join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-simd.wasm'), 'tesseract-core-simd.wasm'],
  [join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-lstm.wasm'), 'tesseract-core-lstm.wasm'],
  [join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm'), 'tesseract-core-simd-lstm.wasm'],
];

mkdirSync(outDir, { recursive: true });

for (const [source, targetName] of copies) {
  if (!existsSync(source)) {
    console.warn(`Missing Tesseract asset: ${source}`);
    continue;
  }
  cpSync(source, join(outDir, targetName));
}

const langDir = join(outDir, 'lang');
mkdirSync(langDir, { recursive: true });

async function ensureLanguageFile(filename, urls, label, minBytes = 0) {
  const langFile = join(langDir, filename);
  if (existsSync(langFile)) {
    const { size } = await import('node:fs/promises').then((fs) => fs.stat(langFile));
    if (size >= minBytes) return;
    console.log(`Replacing outdated ${filename} (${size} bytes)...`);
  } else {
    console.log(`Downloading ${label} OCR language data (one-time)...`);
  }
  let downloaded = false;

  for (const langUrl of urls) {
    const response = await fetch(langUrl);
    if (!response.ok) continue;
    writeFileSync(langFile, Buffer.from(await response.arrayBuffer()));
    downloaded = true;
    console.log(`Saved ${filename} from ${langUrl}`);
    break;
  }

  if (!downloaded) {
    throw new Error(`Failed to download OCR language data: ${filename}`);
  }
}

await ensureLanguageFile('eng.traineddata.gz', [
  'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz',
  'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz',
], 'English', 4_000_000);

await ensureLanguageFile('hin.traineddata.gz', [
  'https://tessdata.projectnaptha.com/4.0.0/hin.traineddata.gz',
  'https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/hin.traineddata.gz',
], 'Hindi');

console.log('Copied Tesseract OCR assets to public/tesseract/');
