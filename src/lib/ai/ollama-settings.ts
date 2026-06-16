import {
  checkOllamaConnection,
  DEFAULT_OLLAMA_ENDPOINT,
  isVisionModel,
  listOllamaModels,
  pickVisionModel,
  type OllamaModel,
} from '@/lib/ai/ollama-client';
import { sendExtensionMessageSafe } from '@/lib/messaging/extension-messages';
import { getSettings, saveSettings } from '@/lib/storage/chrome-storage';

async function listModelsWithFallback(endpoint: string): Promise<OllamaModel[]> {
  try {
    const check = await checkOllamaConnection(endpoint);
    if (!check.ok) return [];
    return await listOllamaModels(endpoint);
  } catch {
    const fallback = await sendExtensionMessageSafe({
      type: 'LIST_OLLAMA_MODELS',
      payload: { endpoint },
    });
    return Array.isArray(fallback) ? (fallback as OllamaModel[]) : [];
  }
}

/** Pick and persist the best Ollama text + vision models when available. */
export async function ensureOllamaModelsSelected(): Promise<{
  textModel: string | null;
  visionModel: string | null;
}> {
  const settings = await getSettings();
  const endpoint = settings.ollamaEndpoint ?? DEFAULT_OLLAMA_ENDPOINT;
  const models = await listModelsWithFallback(endpoint);

  const updates: Partial<typeof settings> = {
    aiProvider: 'ollama',
    documentScanProvider: settings.documentScanProvider ?? 'ollama',
  };

  let textModel: string | null = settings.ollamaModel?.trim() || null;
  let visionModel: string | null = settings.ollamaVisionModel?.trim() || null;

  if (models.length > 0) {
    const textCandidates = models.filter((model) => !isVisionModel(model.name));
    const preferredText = textModel && textCandidates.some((m) => m.name === textModel)
      ? textModel
      : textCandidates[0]?.name ?? models[0]?.name ?? null;

    if (preferredText) {
      textModel = preferredText;
      updates.ollamaModel = preferredText;
    }

    const pickedVision = pickVisionModel(
      models,
      textModel ?? undefined,
      visionModel ?? undefined,
    );
    if (pickedVision) {
      visionModel = pickedVision;
      updates.ollamaVisionModel = pickedVision;
    }
  }

  await saveSettings(updates);
  return { textModel, visionModel };
}
