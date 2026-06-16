import { sendExtensionMessage } from '@/lib/messaging/extension-messages';
import type { ExtensionMessage } from '@/types';

export async function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  const response = await sendExtensionMessage<Record<string, unknown>>(message);
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(String(response.error));
  }
  return response as T;
}

export async function fetchVaultContext(): Promise<{
  vaultData: Record<string, string>;
  profileId: string;
} | null> {
  await sendExtensionMessage({ type: 'AUTO_INIT_VAULT' });

  const response = await sendMessage<{
    vaultData?: Record<string, string>;
    profileId?: string;
    error?: string;
  }>({ type: 'FILL_FORM' });

  if (!response?.vaultData || !response.profileId) return null;
  return { vaultData: response.vaultData, profileId: response.profileId };
}
