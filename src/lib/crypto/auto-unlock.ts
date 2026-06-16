import {
  isVaultInitialized,
  loadSession,
  resetVaultToLocalKey,
  setupVault,
  unlockVault,
} from '@/lib/crypto/session';
import { setEncryptionPassword } from '@/lib/storage/indexed-db';

/** Device-local key — vault is always open, no user password prompt. */
export const LOCAL_VAULT_KEY = 'formvault-local-storage-key';

export async function ensureVaultUnlocked(): Promise<boolean> {
  await loadSession();

  if (!(await isVaultInitialized())) {
    await setupVault(LOCAL_VAULT_KEY);
  } else {
    const unlocked = await unlockVault(LOCAL_VAULT_KEY);
    if (!unlocked) {
      await resetVaultToLocalKey(LOCAL_VAULT_KEY);
    }
  }

  setEncryptionPassword(LOCAL_VAULT_KEY);
  return true;
}
