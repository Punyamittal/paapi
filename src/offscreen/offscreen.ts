import { createWorker, PSM, type Worker } from 'tesseract.js';
import { base64ToArrayBuffer } from '@/lib/documents/binary-transfer';

const MIN_IMAGE_DIMENSION = 1200;
const MAX_IMAGE_DIMENSION = 2600;
const IMAGE_LOAD_TIMEOUT_MS = 10_000;
const OCR_INIT_TIMEOUT_MS = 90_000;
const OCR_RECOGNIZE_TIMEOUT_MS = 45_000;

type OcrDocumentHint = 'default' | 'id-card';

interface WorkerState {
  langs: string;
  promise: Promise<Worker>;
}

let workerState: WorkerState | null = null;

function getTesseractBasePath(): string {
  return chrome.runtime.getURL('tesseract/');
}

function reportProgress(requestId: string, status: string, progress?: number): void {
  chrome.runtime.sendMessage({ type: 'OCR_PROGRESS', requestId, status, progress }).catch(() => {
    // Popup may be closed; ignore.
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(message));
      });
  });
}

function inferImageMimeType(filename: string, mimeType: string): string {
  if (mimeType.startsWith('image/')) return mimeType;
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  return 'image/png';
}

function resolveOcrLangs(hint: OcrDocumentHint, filename: string): string[] {
  if (hint === 'id-card' || /aadhaar|aadhar|pan|passport|license|licence|id.?card/i.test(filename)) {
    return ['eng', 'eng+hin'];
  }
  return ['eng'];
}

function scoreOcrText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const letters = (trimmed.match(/[A-Za-z\u0900-\u097F]/g) ?? []).length;
  const digits = (trimmed.match(/\d/g) ?? []).length;
  return letters + digits * 4 + Math.min(trimmed.length, 500);
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

function computeScaledSize(width: number, height: number): { width: number; height: number } {
  const largestSide = Math.max(width, height);
  let scale = 1;
  if (largestSide < MIN_IMAGE_DIMENSION) scale = MIN_IMAGE_DIMENSION / largestSide;
  else if (largestSide > MAX_IMAGE_DIMENSION) scale = MAX_IMAGE_DIMENSION / largestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawScaledImage(img: HTMLImageElement): HTMLCanvasElement {
  const { width, height } = computeScaledSize(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare image canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

function cropRegion(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const ctx = output.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return output;
}

function applyGrayscaleContrast(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = canvas.width;
  output.height = canvas.height;
  const srcCtx = canvas.getContext('2d');
  const dstCtx = output.getContext('2d');
  if (!srcCtx || !dstCtx) return canvas;

  const imageData = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  let min = 255;
  let max = 0;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    min = Math.min(min, gray);
    max = Math.max(max, gray);
  }

  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const stretched = Math.round(((data[i] - min) / range) * 255);
    data[i] = stretched;
    data[i + 1] = stretched;
    data[i + 2] = stretched;
  }

  dstCtx.putImageData(imageData, 0, 0);
  return output;
}

function applySharpen(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = canvas.width;
  output.height = canvas.height;
  const srcCtx = canvas.getContext('2d');
  const dstCtx = output.getContext('2d');
  if (!srcCtx || !dstCtx) return canvas;

  const source = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const target = dstCtx.createImageData(canvas.width, canvas.height);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const pixel = ((y + ky) * canvas.width + (x + kx)) * 4 + channel;
            value += source.data[pixel] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        const targetIndex = (y * canvas.width + x) * 4 + channel;
        target.data[targetIndex] = Math.max(0, Math.min(255, value));
        target.data[targetIndex + 3] = 255;
      }
    }
  }

  dstCtx.putImageData(target, 0, 0);
  return output;
}

async function buildCanvasVariantsAsync(
  dataBase64: string,
  mimeType: string,
  isIdCard: boolean,
): Promise<HTMLCanvasElement[]> {
  const data = base64ToArrayBuffer(dataBase64);
  const blob = new Blob([data], { type: mimeType });
  const img = await withTimeout(loadImageElement(blob), IMAGE_LOAD_TIMEOUT_MS, 'Image load timed out');
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error('Could not read image dimensions');
  }

  const scaled = drawScaledImage(img);
  const contrast = applyGrayscaleContrast(scaled);
  const sharpened = applySharpen(contrast);
  const variants = [scaled, contrast, sharpened];

  if (isIdCard) {
    const bottomHeight = Math.round(scaled.height * 0.38);
    variants.push(
      cropRegion(scaled, 0, scaled.height - bottomHeight, scaled.width, bottomHeight),
      cropRegion(contrast, 0, contrast.height - bottomHeight, contrast.width, bottomHeight),
    );

    const insetX = Math.round(scaled.width * 0.06);
    const insetY = Math.round(scaled.height * 0.06);
    variants.push(
      cropRegion(
        scaled,
        insetX,
        insetY,
        scaled.width - insetX * 2,
        scaled.height - insetY * 2,
      ),
    );
  }

  return variants;
}

async function createOcrWorker(langs: string, requestId: string): Promise<Worker> {
  reportProgress(requestId, 'Loading OCR engine', 15);
  const basePath = getTesseractBasePath();
  const worker = await createWorker(langs, 1, {
    workerPath: `${basePath}worker.min.js`,
    corePath: basePath,
    langPath: `${basePath}lang`,
    workerBlobURL: false,
    gzip: true,
    logger: (message) => {
      if (!message.status) return;
      reportProgress(requestId, message.status, Math.round((message.progress ?? 0) * 100));
    },
  });

  await worker.setParameters({
    user_defined_dpi: '300',
    preserve_interword_spaces: '1',
  });

  return worker;
}

async function getOcrWorker(langs: string, requestId: string): Promise<Worker> {
  if (workerState && workerState.langs !== langs) {
    const existing = await workerState.promise.catch(() => null);
    await existing?.terminate();
    workerState = null;
  }

  if (!workerState) {
    workerState = {
      langs,
      promise: withTimeout(
        createOcrWorker(langs, requestId),
        OCR_INIT_TIMEOUT_MS,
        'OCR engine load timed out',
      ).catch((error) => {
        workerState = null;
        throw error;
      }),
    };
  }

  return workerState.promise;
}

async function recognizeCanvas(
  worker: Worker,
  canvas: HTMLCanvasElement,
  psm: PSM,
  extraParams?: Record<string, string | number>,
): Promise<string> {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    tessedit_char_whitelist: '',
    ...extraParams,
  });

  const result = await withTimeout(
    worker.recognize(canvas),
    OCR_RECOGNIZE_TIMEOUT_MS,
    'OCR pass timed out',
  );

  return result.data.text.trim();
}

async function recognizeBestText(
  worker: Worker,
  variants: HTMLCanvasElement[],
  requestId: string,
): Promise<string> {
  const psmModes = [PSM.AUTO, PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK, PSM.RAW_LINE];
  let bestText = '';
  let bestScore = 0;
  let pass = 0;
  const totalPasses = variants.length * psmModes.length;

  for (const variant of variants) {
    for (const psm of psmModes) {
      pass += 1;
      reportProgress(
        requestId,
        'Reading text from image',
        Math.round(20 + (pass / totalPasses) * 60),
      );

      try {
        const text = await recognizeCanvas(worker, variant, psm);
        const score = scoreOcrText(text);
        if (score > bestScore) {
          bestScore = score;
          bestText = text;
        }
        if (bestScore >= 60) return bestText;
      } catch {
        // Try next pass.
      }
    }
  }

  return bestText;
}

async function recognizeAadhaarDigits(
  worker: Worker,
  variants: HTMLCanvasElement[],
): Promise<string> {
  let bestDigits = '';

  for (const variant of variants) {
    for (const psm of [PSM.SINGLE_LINE, PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT]) {
      try {
        const text = await recognizeCanvas(worker, variant, psm, {
          tessedit_char_whitelist: '0123456789 ',
        });
        const digits = text.replace(/\D/g, '');
        if (digits.length >= 12) {
          bestDigits = digits.slice(0, 12);
          break;
        }
      } catch {
        // Continue.
      }
    }
    if (bestDigits.length === 12) break;
  }

  await worker.setParameters({ tessedit_char_whitelist: '' });

  if (bestDigits.length === 12) {
    return bestDigits.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
  }
  return '';
}

async function runOcr(
  requestId: string,
  dataBase64: string,
  mimeType: string,
  filename: string,
  hint: OcrDocumentHint,
): Promise<string> {
  const resolvedMime = inferImageMimeType(filename, mimeType);
  const isIdCard = hint === 'id-card' || /aadhaar|aadhar|pan|passport|license|licence|id.?card/i.test(filename);
  const langCandidates = resolveOcrLangs(hint, filename);

  reportProgress(requestId, 'Preparing image', 10);
  const variants = await buildCanvasVariantsAsync(dataBase64, resolvedMime, isIdCard);

  let bestText = '';
  let bestScore = 0;
  let lastError: Error | null = null;

  for (const langs of langCandidates) {
    try {
      reportProgress(requestId, `Loading ${langs} OCR`, 15);
      const worker = await getOcrWorker(langs, requestId);
      const text = await recognizeBestText(worker, variants, requestId);
      const score = scoreOcrText(text);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
      if (bestScore >= 40) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('OCR failed');
    }
  }

  if (isIdCard && bestScore < 40) {
    try {
      const worker = await getOcrWorker(langCandidates[langCandidates.length - 1], requestId);
      const retryText = await recognizeBestText(worker, variants.slice(0, 2), requestId);
      const retryScore = scoreOcrText(retryText);
      if (retryScore > bestScore) {
        bestScore = retryScore;
        bestText = retryText;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }

  if (isIdCard) {
    reportProgress(requestId, 'Scanning ID numbers', 85);
    try {
      const worker = await getOcrWorker(langCandidates[0], requestId);
      const aadhaarDigits = await recognizeAadhaarDigits(worker, variants);
      if (aadhaarDigits) {
        bestText = bestText ? `${bestText}\nAadhaar: ${aadhaarDigits}` : `Aadhaar: ${aadhaarDigits}`;
        bestScore = Math.max(bestScore, 40);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }

  if (!bestText.trim() && lastError) {
    throw lastError;
  }

  reportProgress(requestId, 'OCR complete', 100);
  return bestText.trim();
}

async function warmUp(): Promise<void> {
  await getOcrWorker('eng', 'warmup');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OCR_WARMUP_REQUEST') {
    warmUp()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({ error: error instanceof Error ? error.message : 'OCR warmup failed' });
      });
    return true;
  }

  if (message.type === 'OCR_PROCESS') {
    const payload = message.payload as {
      requestId: string;
      dataBase64: string;
      mimeType: string;
      filename: string;
      hint: OcrDocumentHint;
    };

    runOcr(
      payload.requestId,
      payload.dataBase64,
      payload.mimeType,
      payload.filename,
      payload.hint,
    )
      .then((text) => {
        chrome.runtime.sendMessage({
          type: 'OCR_COMPLETE',
          requestId: payload.requestId,
          text,
        });
        sendResponse({ ok: true });
      })
      .catch((error: unknown) => {
        chrome.runtime.sendMessage({
          type: 'OCR_COMPLETE',
          requestId: payload.requestId,
          error: error instanceof Error ? error.message : 'OCR failed',
        });
        sendResponse({ error: error instanceof Error ? error.message : 'OCR failed' });
      });

    return true;
  }

  return false;
});
