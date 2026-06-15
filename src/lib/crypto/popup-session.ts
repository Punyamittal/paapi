import {
  setEncryptionPassword,
  clearEncryptionPassword,
} from '@/lib/storage/indexed-db';

let popupPassword: string | null = null;

export function setPopupEncryptionPassword(password: string): void {
  popupPassword = password;
  setEncryptionPassword(password);
}

export function clearPopupEncryptionPassword(): void {
  popupPassword = null;
  clearEncryptionPassword();
}

export function hasPopupEncryptionPassword(): boolean {
  return popupPassword !== null;
}
