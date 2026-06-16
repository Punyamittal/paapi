import { ensureOllamaModelsSelected } from '@/lib/ai/ollama-settings';
import { ensureVaultUnlocked, LOCAL_VAULT_KEY } from '@/lib/crypto/auto-unlock';
import {
  getSession,
  loadSession,
  setActiveProfile,
  touchSession,
} from '@/lib/crypto/session';
import { setEncryptionPassword } from '@/lib/storage/indexed-db';
import { getSettings } from '@/lib/storage/chrome-storage';
import {
  applyExtractedFieldsToVault,
  getVaultData,
  initializeDefaultProfile,
  syncFormFieldsToVault,
} from '@/lib/vault/vault-service';
import { extractFieldsWithOllamaDirect } from '@/lib/documents/ollama-paste-extract';
import type { ExtensionMessage } from '@/types';
import { runOcrInOffscreen, warmUpOcrInOffscreen } from '@/background/offscreen-ocr';

async function bootstrapExtension(): Promise<void> {
  await loadSession();
  await ensureVaultUnlocked();
  const profile = await initializeDefaultProfile();
  if (!getSession().activeProfileId) {
    setActiveProfile(profile.id);
  }
  await ensureOllamaModelsSelected();
}

void bootstrapExtension();

chrome.runtime.onStartup.addListener(() => {
  void bootstrapExtension();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    touchSession();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await bootstrapExtension();
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    let responded = false;
    const safeRespond = (value: unknown) => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(value);
      } catch {
        // Popup closed before the response was delivered.
      }
    };

    handleMessage(message)
      .then(safeRespond)
      .catch((err: Error) => {
        safeRespond({ error: err.message });
      });
    return true;
  },
);

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'AUTO_INIT_VAULT': {
      await ensureVaultUnlocked();
      setEncryptionPassword(LOCAL_VAULT_KEY);
      const profile = await initializeDefaultProfile();
      if (!getSession().activeProfileId) {
        setActiveProfile(profile.id);
      }
      const models = await ensureOllamaModelsSelected();
      return {
        success: true,
        profileId: getSession().activeProfileId,
        ...models,
      };
    }

    case 'UNLOCK_VAULT': {
      await ensureVaultUnlocked();
      setEncryptionPassword(LOCAL_VAULT_KEY);
      const profile = await initializeDefaultProfile();
      if (!getSession().activeProfileId) {
        setActiveProfile(profile.id);
      }
      return { success: true, profileId: getSession().activeProfileId };
    }

    case 'LOCK_VAULT': {
      return { success: true };
    }

    case 'GET_SESSION': {
      await ensureVaultUnlocked();
      return { ...getSession(), isUnlocked: true };
    }

    case 'PING': {
      return { ok: true };
    }

    case 'SWITCH_PROFILE': {
      const { profileId } = message.payload as { profileId: string };
      setActiveProfile(profileId);
      return { success: true };
    }

    case 'GET_PROFILES': {
      try {
        const { getAllProfiles } = await import('@/lib/storage/indexed-db');
        const profiles = await getAllProfiles();
        return Array.isArray(profiles) ? profiles : [];
      } catch {
        return [];
      }
    }

    case 'FILL_FORM': {
      await ensureVaultUnlocked();
      setEncryptionPassword(LOCAL_VAULT_KEY);

      let profileId = getSession().activeProfileId;
      if (!profileId) {
        const profile = await initializeDefaultProfile();
        profileId = profile.id;
        setActiveProfile(profileId);
      }

      const vaultData = await getVaultData(profileId);
      return { vaultData, profileId };
    }

    case 'SEARCH_VAULT': {
      const { query, profileId } = message.payload as {
        query: string;
        profileId: string;
      };
      const {
        getFieldsByProfile,
        getDocumentsByProfile,
        getAnswersByProfile,
      } = await import('@/lib/storage/indexed-db');
      const { searchVault } = await import('@/lib/search/search-engine');

      const [fields, documents, answers] = await Promise.all([
        getFieldsByProfile(profileId),
        getDocumentsByProfile(profileId),
        getAnswersByProfile(profileId),
      ]);

      return searchVault(query, fields, documents, answers);
    }

    case 'GENERATE_ANSWER': {
      await ensureVaultUnlocked();
      setEncryptionPassword(LOCAL_VAULT_KEY);
      const session = getSession();
      if (!session.activeProfileId) {
        const profile = await initializeDefaultProfile();
        setActiveProfile(profile.id);
      }

      const request = message.payload as import('@/types').GenerateAnswerRequest;
      const {
        getFieldsByProfile,
        getAnswersByProfile,
        getDocumentsByProfile,
      } = await import('@/lib/storage/indexed-db');
      const { generateLocalAnswer, generateAnswerWithAPI, generateAnswerWithOllama } =
        await import('@/lib/ai/ai-engine');
      const settings = await getSettings();

      const activeProfileId = getSession().activeProfileId!;
      const [fields, answers, documents] = await Promise.all([
        getFieldsByProfile(activeProfileId),
        getAnswersByProfile(activeProfileId),
        getDocumentsByProfile(activeProfileId),
      ]);

      const documentTexts = documents.map((d) => d.extractedText);

      if (settings.aiProvider === 'ollama') {
        return generateAnswerWithOllama(
          request,
          fields,
          answers,
          documentTexts,
          settings.ollamaEndpoint,
          settings.ollamaModel ?? '',
        );
      }

      if (
        settings.aiProvider !== 'local' &&
        settings.aiApiKey &&
        settings.aiApiEndpoint
      ) {
        return generateAnswerWithAPI(
          request,
          fields,
          settings.aiApiKey,
          settings.aiApiEndpoint,
        );
      }

      return generateLocalAnswer(
        request,
        fields,
        answers,
        documentTexts,
      );
    }

    case 'LIST_OLLAMA_MODELS': {
      try {
        const { endpoint } = (message.payload as { endpoint?: string }) ?? {};
        const { listOllamaModels } = await import('@/lib/ai/ollama-client');
        const settings = await getSettings();
        const models = await listOllamaModels(endpoint ?? settings.ollamaEndpoint);
        return Array.isArray(models) ? models : [];
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : 'Failed to list Ollama models',
        };
      }
    }

    case 'CHECK_OLLAMA': {
      const { endpoint } = (message.payload as { endpoint?: string }) ?? {};
      const { checkOllamaConnection } = await import('@/lib/ai/ollama-client');
      const settings = await getSettings();
      return checkOllamaConnection(endpoint ?? settings.ollamaEndpoint);
    }

    case 'RUN_OCR': {
      const payload = message.payload as import('@/background/offscreen-ocr').OcrRequestPayload;
      return runOcrInOffscreen(payload);
    }

    case 'OCR_WARMUP': {
      await warmUpOcrInOffscreen();
      return { ok: true };
    }

    case 'EXTRACT_DOCUMENT_VISION': {
      const payload = message.payload as {
        endpoint: string;
        model: string;
        prompt: string;
        imageBase64: string;
      };
      const { extractDocumentWithOllamaVisionDirect } = await import(
        '@/lib/documents/ollama-document-extractor'
      );
      const content = await extractDocumentWithOllamaVisionDirect(payload);
      return { content };
    }

    case 'SCAN_DOCUMENT_OLLAMA': {
      const payload = message.payload as {
        dataBase64: string;
        mimeType: string;
        filename: string;
        documentType: import('@/types').DocumentType;
      };
      const { scanDocumentWithOllamaFromBase64 } = await import(
        '@/lib/documents/ollama-document-extractor'
      );
      return scanDocumentWithOllamaFromBase64(payload);
    }

    case 'EXTRACT_PASTE_TEXT':
    case 'EXTRACT_FOR_PAGE': {
      try {
        const payload = message.payload as {
          endpoint: string;
          model: string;
          text: string;
          formTargets?: import('@/types').FormTargetField[];
        };
        const fields = await extractFieldsWithOllamaDirect(payload);
        return { fields };
      } catch (error) {
        return {
          fields: [],
          error: error instanceof Error ? error.message : 'Paste extraction failed',
        };
      }
    }

    case 'APPLY_EXTRACTED_TO_VAULT': {
      await ensureVaultUnlocked();
      setEncryptionPassword(LOCAL_VAULT_KEY);

      const { profileId, fields } = message.payload as {
        profileId: string;
        fields: import('@/types').ExtractedField[];
      };

      let activeProfileId = profileId || getSession().activeProfileId;
      if (!activeProfileId) {
        const profile = await initializeDefaultProfile();
        activeProfileId = profile.id;
        setActiveProfile(activeProfileId);
      }

      return applyExtractedFieldsToVault(activeProfileId, fields);
    }

    case 'SYNC_PAGE_FORM_FIELDS': {
      await ensureVaultUnlocked();
      setEncryptionPassword(LOCAL_VAULT_KEY);

      const { profileId, url, fields } = message.payload as {
        profileId: string;
        url: string;
        fields: import('@/types').PageFormFieldDescriptor[];
      };

      let activeProfileId = profileId || getSession().activeProfileId;
      if (!activeProfileId) {
        const profile = await initializeDefaultProfile();
        activeProfileId = profile.id;
        setActiveProfile(activeProfileId);
      }

      return syncFormFieldsToVault(activeProfileId, fields, url);
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// Keep session alive on extension activity
chrome.runtime.onConnect.addListener(() => {
  touchSession();
});
