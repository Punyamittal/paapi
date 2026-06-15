const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

let creatingOffscreen: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen) {
    throw new Error('Offscreen API is unavailable in this browser.');
  }

  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });

  if (existing.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Run local OCR on uploaded ID documents and images.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });

  await creatingOffscreen;
}

export interface OcrRequestPayload {
  requestId: string;
  dataBase64: string;
  mimeType: string;
  filename: string;
  hint: 'default' | 'id-card';
}

export async function runOcrInOffscreen(
  payload: OcrRequestPayload,
  timeoutMs = 120_000,
): Promise<{ text: string }> {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      reject(new Error('OCR timed out. Try a smaller or clearer image.'));
    }, timeoutMs);

    const onMessage = (message: {
      type?: string;
      requestId?: string;
      text?: string;
      error?: string;
    }) => {
      if (message.type !== 'OCR_COMPLETE' || message.requestId !== payload.requestId) {
        return;
      }

      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);

      if (message.error) {
        reject(new Error(message.error));
        return;
      }

      resolve({ text: message.text ?? '' });
    };

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.runtime.sendMessage({ type: 'OCR_PROCESS', payload }).catch((error: unknown) => {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
      reject(error instanceof Error ? error : new Error('Failed to start OCR'));
    });
  });
}

export async function warmUpOcrInOffscreen(): Promise<void> {
  await ensureOffscreenDocument();
  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'OCR_WARMUP_REQUEST' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve();
    });
  });
}
