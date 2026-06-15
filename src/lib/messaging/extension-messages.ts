import type { ExtensionMessage } from '@/types';

const PORT_CLOSED =
  /message port closed|receiving end does not exist|extension context invalidated/i;

function isPortClosedError(message: string): boolean {
  return PORT_CLOSED.test(message);
}

function sendMessageOnce<T>(message: ExtensionMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('Extension messaging is unavailable'));
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError?.message) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response as T);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to send extension message'));
    }
  });
}

/** Reliable chrome.runtime.sendMessage with lastError handling and one retry when the SW wakes up. */
export async function sendExtensionMessage<T = unknown>(
  message: ExtensionMessage,
  options?: { retries?: number; retryDelayMs?: number },
): Promise<T> {
  const retries = options?.retries ?? 1;
  const retryDelayMs = options?.retryDelayMs ?? 120;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await sendMessageOnce<T>(message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Extension message failed');
      if (attempt < retries && isPortClosedError(lastError.message)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error('Extension message failed');
}

export async function sendExtensionMessageSafe<T = unknown>(
  message: ExtensionMessage,
): Promise<T | null> {
  try {
    return await sendExtensionMessage<T>(message);
  } catch {
    return null;
  }
}
