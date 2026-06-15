import { encryptData, decryptData } from '@/lib/crypto/encryption';
import { exportAllData, importAllData } from '@/lib/storage/indexed-db';
import type { VaultBackup } from '@/types';

const BACKUP_VERSION = '1.0.0';

export async function exportEncryptedBackup(
  password: string,
): Promise<VaultBackup> {
  const data = await exportAllData();
  const encrypted = await encryptData(data, password);

  return {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    encrypted: true,
    payload: encrypted,
  };
}

export async function exportPlainBackup(): Promise<VaultBackup> {
  const data = await exportAllData();

  return {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    encrypted: false,
    payload: data,
  };
}

export async function importBackup(
  backup: VaultBackup,
  password?: string,
): Promise<void> {
  if (backup.encrypted) {
    if (!password) throw new Error('Password required for encrypted backup');
    const payload = backup.payload as {
      iv: string;
      salt: string;
      ciphertext: string;
    };
    const data = await decryptData<Record<string, unknown>>(payload, password);
    await importAllData(data);
  } else {
    await importAllData(backup.payload as Record<string, unknown>);
  }
}

export function downloadBackupFile(backup: VaultBackup, filename?: string): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `formvault-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readBackupFile(file: File): Promise<VaultBackup> {
  const text = await file.text();
  return JSON.parse(text) as VaultBackup;
}
