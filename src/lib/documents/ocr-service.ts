export { extractTextFromImage } from '@/lib/documents/ocr-client';
export type { OcrDocumentHint } from '@/lib/documents/ocr-client';

let progressHandler: ((message: string, progress?: number) => void) | null = null;
let progressListenerInstalled = false;

function ensureProgressListener(): void {
  if (progressListenerInstalled || typeof chrome === 'undefined') return;

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'OCR_PROGRESS' || !progressHandler) return;
    if (message.progress !== undefined) {
      progressHandler(message.status, message.progress);
    } else {
      progressHandler(message.status);
    }
  });

  progressListenerInstalled = true;
}

function sendMessage<T>(payload: { type: string; payload?: unknown }): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response as T);
    });
  });
}

export function setOcrProgressHandler(
  handler: ((message: string, progress?: number) => void) | null,
): void {
  progressHandler = handler;
  ensureProgressListener();
}

export async function warmUpOcr(): Promise<void> {
  ensureProgressListener();
  await sendMessage<{ ok: boolean }>({ type: 'OCR_WARMUP' });
}

export async function terminateOcrWorker(): Promise<void> {
  // Worker lives in the offscreen document.
}
