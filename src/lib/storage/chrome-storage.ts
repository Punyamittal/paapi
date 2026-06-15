import type { AppSettings } from '@/types';

const SETTINGS_KEY = 'formvault_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  autoLockMinutes: 15,
  enableBiometric: false,
  enableTextExpansion: true,
  enableFloatingAssistant: true,
  enableSidebar: false,
  highContrast: false,
  fontSize: 'md',
  aiProvider: 'local',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  ollamaModel: '',
  ollamaVisionModel: '',
  documentScanProvider: 'ollama',
};

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] as Partial<AppSettings>) };
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return updated;
}

export async function getSetting<K extends keyof AppSettings>(
  key: K,
): Promise<AppSettings[K]> {
  const settings = await getSettings();
  return settings[key];
}
