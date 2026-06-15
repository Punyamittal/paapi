import { useState, useEffect, useCallback } from 'react';
import { Download, Upload, Shield, Clock, RefreshCw } from 'lucide-react';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '@/lib/storage/chrome-storage';
import {
  exportEncryptedBackup,
  exportPlainBackup,
  downloadBackupFile,
  readBackupFile,
  importBackup,
} from '@/lib/backup/backup-service';
import {
  checkOllamaConnection,
  DEFAULT_OLLAMA_ENDPOINT,
  formatModelSize,
  isVisionModel,
  listOllamaModels,
  type OllamaModel,
} from '@/lib/ai/ollama-client';
import { sendExtensionMessageSafe } from '@/lib/messaging/extension-messages';
import type { AppSettings } from '@/types';

function normalizeModels(value: unknown): OllamaModel[] {
  return Array.isArray(value) ? value : [];
}

export function SettingsView() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [backupPassword, setBackupPassword] = useState('');
  const [status, setStatus] = useState('');
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState('');
  const [loadingOllama, setLoadingOllama] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const refreshOllamaModels = useCallback(
    async (endpoint?: string, currentModel?: string) => {
      const endpointUrl = (endpoint ?? DEFAULT_OLLAMA_ENDPOINT).replace(/\/+$/, '');
      setLoadingOllama(true);
      setOllamaStatus('');

      try {
        let models: OllamaModel[] = [];

        try {
          const check = await checkOllamaConnection(endpointUrl);
          if (!check.ok) {
            setOllamaModels([]);
            setOllamaStatus(check.error ?? 'Cannot reach Ollama. Is it running?');
            return;
          }
          models = await listOllamaModels(endpointUrl);
        } catch {
          const fallback = await sendExtensionMessageSafe({
            type: 'LIST_OLLAMA_MODELS',
            payload: { endpoint: endpointUrl },
          });

          if (fallback && typeof fallback === 'object' && 'error' in fallback) {
            setOllamaModels([]);
            setOllamaStatus(String(fallback.error));
            return;
          }

          models = normalizeModels(fallback);
        }

        setOllamaModels(models);

        if (models.length === 0) {
          setOllamaStatus(
            'Connected, but no models found. Download one with: ollama pull llama3.2-vision',
          );
          return;
        }

        const visionOnly = models.filter((model) => isVisionModel(model.name));
        const selectedModel = currentModel ?? '';
        const modelExists = models.some((model) => model.name === selectedModel);

        if (!selectedModel || !modelExists) {
          const updated = await saveSettings({ ollamaModel: models[0].name });
          setSettings(updated);
        }

        const currentVision = (await getSettings()).ollamaVisionModel;
        if (!currentVision && visionOnly.length > 0) {
          const updated = await saveSettings({ ollamaVisionModel: visionOnly[0].name });
          setSettings(updated);
          setOllamaStatus(
            `Connected — auto-selected vision model ${visionOnly[0].name} for document scans.`,
          );
          return;
        }

        if (!selectedModel || !modelExists) {
          setOllamaStatus(
            `Connected — ${models.length} model(s). Auto-selected ${models[0].name}.`,
          );
          return;
        }

        setOllamaStatus(`Connected — ${models.length} downloaded model(s) available`);
      } catch {
        setOllamaModels([]);
        setOllamaStatus('Cannot reach Ollama. Start it with: ollama serve');
      } finally {
        setLoadingOllama(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (settings.documentScanProvider !== 'tesseract') {
      void refreshOllamaModels(settings.ollamaEndpoint, settings.ollamaModel);
    }
  }, [settings.documentScanProvider, settings.ollamaEndpoint, refreshOllamaModels]);

  const updateSetting = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    const updated = await saveSettings({ [key]: value });
    setSettings(updated);
  };

  const handleExport = async (encrypted: boolean) => {
    try {
      const backup = encrypted
        ? await exportEncryptedBackup(backupPassword || 'formvault')
        : await exportPlainBackup();
      downloadBackupFile(backup);
      setStatus('Backup exported successfully');
    } catch {
      setStatus('Export failed');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const backup = await readBackupFile(file);
      await importBackup(backup, backupPassword || undefined);
      setStatus('Backup restored successfully');
    } catch {
      setStatus('Import failed — check password and file format');
    }
  };

  const modelList = Array.isArray(ollamaModels) ? ollamaModels : [];
  const selectedModel = modelList.find((model) => model.name === settings.ollamaModel);
  const visionModels = modelList.filter((model) => isVisionModel(model.name));
  const selectedVisionModel = modelList.find(
    (model) => model.name === settings.ollamaVisionModel,
  );

  return (
    <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
      <h2 className="text-sm font-semibold text-slate-700">Settings</h2>

      {/* Security */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
          <Shield className="w-3 h-3" /> Security
        </h3>
        <SettingRow label="Auto-lock after (minutes)">
          <input
            type="number"
            min={1}
            max={120}
            value={settings.autoLockMinutes}
            onChange={(e) => updateSetting('autoLockMinutes', Number(e.target.value))}
            className="w-16 px-2 py-1 text-sm border border-slate-200 rounded-md text-right"
          />
        </SettingRow>
        <ToggleRow
          label="Floating assistant on pages"
          checked={settings.enableFloatingAssistant}
          onChange={(v) => updateSetting('enableFloatingAssistant', v)}
        />
        <ToggleRow
          label="Text expansion (@phone, @email)"
          checked={settings.enableTextExpansion}
          onChange={(v) => updateSetting('enableTextExpansion', v)}
        />
      </section>

      {/* AI */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          AI Provider
        </h3>
        <select
          value={settings.aiProvider}
          onChange={(e) =>
            updateSetting('aiProvider', e.target.value as AppSettings['aiProvider'])
          }
          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
        >
          <option value="local">Local templates (offline, no model)</option>
          <option value="ollama">Ollama (local downloaded models)</option>
          <option value="openai">OpenAI (optional API key)</option>
          <option value="anthropic">Anthropic (optional API key)</option>
          <option value="custom">Custom endpoint</option>
        </select>

        {settings.aiProvider === 'ollama' && (
          <div className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
            <p className="text-[10px] text-slate-500">
              Choose from models you downloaded with Ollama. All inference runs locally on
              your machine.
            </p>

            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500">Ollama server</label>
              <input
                value={settings.ollamaEndpoint ?? DEFAULT_OLLAMA_ENDPOINT}
                onChange={(e) => updateSetting('ollamaEndpoint', e.target.value)}
                onBlur={() =>
                  void refreshOllamaModels(settings.ollamaEndpoint, settings.ollamaModel)
                }
                placeholder="http://127.0.0.1:11434"
                className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-medium text-slate-500">
                  Downloaded model
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void refreshOllamaModels(settings.ollamaEndpoint, settings.ollamaModel)
                  }
                  disabled={loadingOllama}
                  className="flex items-center gap-1 text-[10px] text-brand-600 hover:text-brand-700 disabled:opacity-60"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingOllama ? 'animate-spin' : ''}`} />
                  Refresh list
                </button>
              </div>

              <select
                value={settings.ollamaModel ?? ''}
                onChange={(e) => updateSetting('ollamaModel', e.target.value)}
                disabled={loadingOllama || modelList.length === 0}
                className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md disabled:bg-slate-100"
              >
                <option value="">
                  {loadingOllama
                    ? 'Loading models...'
                    : modelList.length === 0
                      ? 'No downloaded models found'
                      : 'Select a downloaded model'}
                </option>
                {modelList.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} ({formatModelSize(model.size)})
                  </option>
                ))}
              </select>
            </div>

            {selectedModel && (
              <p className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">
                Using {selectedModel.name} · {formatModelSize(selectedModel.size)}
              </p>
            )}

            {ollamaStatus && (
              <p className="text-[10px] text-slate-500">{ollamaStatus}</p>
            )}

            <p className="text-[10px] text-slate-400">
              Install from{' '}
              <a
                href="https://ollama.com"
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 underline"
              >
                ollama.com
              </a>
              , then download models with{' '}
              <code className="bg-white px-1 rounded">ollama pull llama3.2</code>
            </p>
          </div>
        )}

        <div className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
          <p className="text-[10px] font-medium text-slate-600">Document scanning (Aadhaar, PAN, IDs)</p>
          <select
            value={settings.documentScanProvider ?? 'auto'}
            onChange={(e) =>
              updateSetting(
                'documentScanProvider',
                e.target.value as AppSettings['documentScanProvider'],
              )
            }
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
          >
            <option value="auto">Auto — Ollama vision if available, else Tesseract</option>
            <option value="ollama">Ollama vision only (best for Aadhaar/PAN)</option>
            <option value="tesseract">Tesseract OCR only (offline, less accurate)</option>
          </select>

          {(settings.documentScanProvider ?? 'auto') !== 'tesseract' && (
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500">
                Vision model for document scans
              </label>
              <select
                value={settings.ollamaVisionModel ?? ''}
                onChange={(e) => updateSetting('ollamaVisionModel', e.target.value)}
                disabled={loadingOllama || visionModels.length === 0}
                className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md disabled:bg-slate-100"
              >
                <option value="">
                  {visionModels.length === 0
                    ? 'No vision model found — pull one first'
                    : 'Auto-select first vision model'}
                </option>
                {visionModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} ({formatModelSize(model.size)})
                  </option>
                ))}
              </select>
              {selectedVisionModel && (
                <p className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">
                  Document scans use {selectedVisionModel.name}
                </p>
              )}
              {visionModels.length === 0 && settings.aiProvider === 'ollama' && (
                <p className="text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded-md">
                  Pull a vision model:{' '}
                  <code className="bg-white px-1 rounded">ollama pull llama3.2-vision</code>
                </p>
              )}
            </div>
          )}
        </div>

        {settings.aiProvider !== 'local' && settings.aiProvider !== 'ollama' && (
          <>
            <input
              type="password"
              value={settings.aiApiKey ?? ''}
              onChange={(e) => updateSetting('aiApiKey', e.target.value)}
              placeholder="API Key (stored locally only)"
              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
            />
            <input
              value={settings.aiApiEndpoint ?? ''}
              onChange={(e) => updateSetting('aiApiEndpoint', e.target.value)}
              placeholder="API Endpoint URL"
              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
            />
          </>
        )}
      </section>

      {/* Backup */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
          <Clock className="w-3 h-3" /> Backup & Restore
        </h3>
        <input
          type="password"
          value={backupPassword}
          onChange={(e) => setBackupPassword(e.target.value)}
          placeholder="Backup encryption password"
          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md"
        />
        <div className="flex gap-2">
          <button
            onClick={() => handleExport(true)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium text-brand-600 bg-brand-50 rounded-md hover:bg-brand-100"
          >
            <Download className="w-3 h-3" />
            Encrypted Export
          </button>
          <label className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-slate-100 cursor-pointer">
            <Upload className="w-3 h-3" />
            Import
            <input type="file" accept=".json" className="hidden" onChange={handleImport} />
          </label>
        </div>
      </section>

      {status && (
        <p className="text-xs text-center text-slate-500">{status}</p>
      )}

      <p className="text-[10px] text-slate-400 text-center pt-2">
        All data is stored locally and encrypted on your device.
        No cloud. No tracking. No accounts.
      </p>
    </div>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-600">{label}</span>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-600">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-brand-500' : 'bg-slate-200'
        }`}
      >
        <div
          className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
