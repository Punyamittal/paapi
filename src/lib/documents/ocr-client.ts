import {
  arrayBufferToBase64,
  normalizeToArrayBuffer,
} from '@/lib/documents/binary-transfer';

export type OcrDocumentHint = 'default' | 'id-card';

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

export async function extractTextFromImage(
  data: ArrayBuffer,
  mimeType: string,
  filename = 'image.png',
  hint: OcrDocumentHint = 'default',
): Promise<string> {
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onComplete);
      reject(new Error('OCR timed out. Try a smaller or clearer image.'));
    }, 120_000);

    const onComplete = (message: {
      type?: string;
      requestId?: string;
      text?: string;
      error?: string;
    }) => {
      if (message.type !== 'OCR_COMPLETE' || message.requestId !== requestId) return;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onComplete);
      if (message.error) reject(new Error(message.error));
      else resolve(message.text ?? '');
    };

    chrome.runtime.onMessage.addListener(onComplete);

    sendMessage<{ ok: boolean }>({
      type: 'RUN_OCR',
      payload: {
        requestId,
        dataBase64: arrayBufferToBase64(normalizeToArrayBuffer(data)),
        mimeType,
        filename,
        hint,
      },
    }).catch((error) => {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onComplete);
      reject(error);
    });
  });
}
