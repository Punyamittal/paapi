import {
  getSession,
  loadSession,
  lockVault,
  setActiveProfile,
  touchSession,
  unlockVault,
} from '@/lib/crypto/session';
import { setEncryptionPassword } from '@/lib/storage/indexed-db';
import { getSettings } from '@/lib/storage/chrome-storage';
import { initializeDefaultProfile, getVaultData } from '@/lib/vault/vault-service';
import type { ExtensionMessage } from '@/types';
import { runOcrInOffscreen, warmUpOcrInOffscreen } from '@/background/offscreen-ocr';

chrome.runtime.onInstalled.addListener(async () => {
  await loadSession();
  await initializeDefaultProfile();
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
    case 'UNLOCK_VAULT': {
      const { password } = message.payload as { password: string };
      const success = await unlockVault(password);
      if (success) {
        setEncryptionPassword(password);
        const profile = await initializeDefaultProfile();
        if (!getSession().activeProfileId) {
          setActiveProfile(profile.id);
        }
      }
      return { success, profileId: getSession().activeProfileId };
    }

    case 'LOCK_VAULT': {
      await lockVault();
      setEncryptionPassword('');
      return { success: true };
    }

    case 'GET_SESSION': {
      await loadSession();
      return getSession();
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
      const session = getSession();
      if (!session.isUnlocked) {
        return { error: 'Vault locked' };
      }

      let profileId = session.activeProfileId;
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
      const session = getSession();
      if (!session.isUnlocked || !session.activeProfileId) {
        return { error: 'Vault locked' };
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

      const [fields, answers, documents] = await Promise.all([
        getFieldsByProfile(session.activeProfileId),
        getAnswersByProfile(session.activeProfileId),
        getDocumentsByProfile(session.activeProfileId),
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

    case 'EXTRACT_PASTE_TEXT': {
      try {
        const payload = message.payload as {
          endpoint: string;
          model: string;
          text: string;
        };
        const { extractFieldsWithOllamaDirect } = await import(
          '@/lib/documents/ollama-paste-extract'
        );
        const fields = await extractFieldsWithOllamaDirect(payload);
        return { fields };
      } catch (error) {
        return {
          fields: [],
          error: error instanceof Error ? error.message : 'Paste extraction failed',
        };
      }
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// Auto-lock on inactivity
setInterval(async () => {
  const session = getSession();
  if (!session.isUnlocked) return;

  const settings = await getSettings();
  const lockMs = settings.autoLockMinutes * 60 * 1000;
  if (Date.now() - session.lastActivity > lockMs) {
    await lockVault();
    setEncryptionPassword('');
  }
}, 30_000);

// Keep session alive on extension activity
chrome.runtime.onConnect.addListener(() => {
  touchSession();
});
