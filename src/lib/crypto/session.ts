import type { SessionState } from '@/types';
import { hashPassword, verifyPassword } from './encryption';

const SESSION_KEY = 'formvault_session';
const PASSWORD_HASH_KEY = 'formvault_password_hash';
const DEFAULT_AUTO_LOCK_MINUTES = 15;

let session: SessionState = {
  isUnlocked: false,
  lastActivity: 0,
  activeProfileId: null,
};

let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

export function getSession(): SessionState {
  return { ...session };
}

export async function isVaultInitialized(): Promise<boolean> {
  const result = await chrome.storage.local.get(PASSWORD_HASH_KEY);
  return Boolean(result[PASSWORD_HASH_KEY]);
}

export async function setupVault(password: string): Promise<void> {
  const hash = await hashPassword(password);
  await chrome.storage.local.set({ [PASSWORD_HASH_KEY]: hash });
  session = {
    isUnlocked: true,
    lastActivity: Date.now(),
    activeProfileId: null,
  };
  await persistSession();
}

export async function unlockVault(password: string): Promise<boolean> {
  const result = await chrome.storage.local.get(PASSWORD_HASH_KEY);
  const storedHash = result[PASSWORD_HASH_KEY] as string | undefined;

  if (!storedHash) {
    await setupVault(password);
    return true;
  }

  const valid = await verifyPassword(password, storedHash);
  if (!valid) return false;

  session = {
    isUnlocked: true,
    lastActivity: Date.now(),
    activeProfileId: session.activeProfileId,
  };
  await persistSession();
  resetAutoLockTimer();
  return true;
}

export async function lockVault(): Promise<void> {
  // Vault lock disabled — session stays available for autofill.
  session.lastActivity = Date.now();
  await persistSession();
}

export function touchSession(): void {
  if (!session.isUnlocked) return;
  session.lastActivity = Date.now();
  resetAutoLockTimer();
}

export function setActiveProfile(profileId: string | null): void {
  session.activeProfileId = profileId;
  touchSession();
}

export async function loadSession(): Promise<SessionState> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  if (result[SESSION_KEY]) {
    session = result[SESSION_KEY] as SessionState;
  }
  return getSession();
}

async function persistSession(): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
}

function resetAutoLockTimer(minutes = DEFAULT_AUTO_LOCK_MINUTES): void {
  if (minutes <= 0) {
    if (autoLockTimer) {
      clearTimeout(autoLockTimer);
      autoLockTimer = null;
    }
    return;
  }
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(
    () => {
      void lockVault();
    },
    minutes * 60 * 1000,
  );
}

export async function resetVaultToLocalKey(localKey: string): Promise<void> {
  await chrome.storage.local.remove(PASSWORD_HASH_KEY);
  await setupVault(localKey);
}

export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const result = await chrome.storage.local.get(PASSWORD_HASH_KEY);
  const storedHash = result[PASSWORD_HASH_KEY] as string | undefined;
  if (!storedHash) return false;

  const valid = await verifyPassword(currentPassword, storedHash);
  if (!valid) return false;

  const newHash = await hashPassword(newPassword);
  await chrome.storage.local.set({ [PASSWORD_HASH_KEY]: newHash });
  return true;
}
