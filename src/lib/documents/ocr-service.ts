import { sendExtensionMessageSafe } from '@/lib/messaging/extension-messages';

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

export function setOcrProgressHandler(
  handler: ((message: string, progress?: number) => void) | null,
): void {
  progressHandler = handler;
  ensureProgressListener();
}

export async function warmUpOcr(): Promise<void> {
  ensureProgressListener();
  await sendExtensionMessageSafe({ type: 'OCR_WARMUP' });
}

export async function terminateOcrWorker(): Promise<void> {
  // Worker lives in the offscreen document.
}
