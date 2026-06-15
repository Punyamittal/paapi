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

/** Reliable chrome.runtime.sendMessage with lastError handling and retries when the SW wakes up. */
export async function sendExtensionMessage<T = unknown>(
  message: ExtensionMessage,
  options?: { retries?: number; retryDelayMs?: number },
): Promise<T> {
  const retries = options?.retries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 150;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await sendMessageOnce<T>(message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Extension message failed');
      if (attempt < retries && isPortClosedError(lastError.message)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error('Extension message failed');
}

export async function sendExtensionMessageSafe<T = unknown>(
  message: ExtensionMessage,
  options?: { retries?: number; retryDelayMs?: number },
): Promise<T | null> {
  try {
    return await sendExtensionMessage<T>(message, options);
  } catch {
    return null;
  }
}

/** Keeps the MV3 service worker alive while the popup is open. */
export function connectPopupKeepalive(): (() => void) | undefined {
  if (typeof chrome === 'undefined' || !chrome.runtime?.connect) {
    return undefined;
  }

  try {
    const port = chrome.runtime.connect({ name: 'popup' });
    return () => {
      try {
        port.disconnect();
      } catch {
        // Port may already be closed.
      }
    };
  } catch {
    return undefined;
  }
}

/** Wake the service worker before other messages (common fix for "port closed" on cold start). */
export async function wakeServiceWorker(): Promise<void> {
  await sendExtensionMessageSafe({ type: 'PING' }, { retries: 5, retryDelayMs: 120 });
}
