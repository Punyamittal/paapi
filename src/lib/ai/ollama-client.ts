export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';

export interface OllamaModel {
  name: string;
  size: number;
  modifiedAt: string;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

function endpointOrigin(endpoint: string): string {
  const base = normalizeEndpoint(endpoint);
  try {
    return new URL(base.includes('://') ? base : `http://${base}`).origin;
  } catch {
    return 'http://127.0.0.1:11434';
  }
}

/** Extension popups send chrome-extension:// Origin; Ollama rejects POST unless allowed. */
function ollamaRequestInit(
  endpoint: string,
  init: RequestInit,
): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    headers.set('Origin', endpointOrigin(endpoint));
  }
  return { ...init, headers };
}

function formatOllamaHttpError(status: number, text: string): string {
  if (status === 403) {
    return (
      'Ollama blocked the request (403). Restart Ollama with extension access: ' +
      'OLLAMA_ORIGINS=chrome-extension://* ollama serve ' +
      '(Windows: set OLLAMA_ORIGINS=chrome-extension://* then ollama serve in a new terminal).'
    );
  }
  return `Ollama error (${status})${text ? `: ${text}` : ''}`;
}

export function formatModelSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function listOllamaModels(
  endpoint = DEFAULT_OLLAMA_ENDPOINT,
): Promise<OllamaModel[]> {
  const base = normalizeEndpoint(endpoint);
  const response = await fetch(
    `${base}/api/tags`,
    ollamaRequestInit(base, { method: 'GET' }),
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(formatOllamaHttpError(response.status, text));
  }

  const data = await response.json() as {
    models?: Array<{
      name: string;
      size: number;
      modified_at: string;
    }>;
  };

  const models = Array.isArray(data.models) ? data.models : [];

  return models.map((model) => ({
    name: model.name,
    size: model.size,
    modifiedAt: model.modified_at,
  }));
}

export async function checkOllamaConnection(
  endpoint = DEFAULT_OLLAMA_ENDPOINT,
): Promise<{ ok: boolean; modelCount: number; error?: string }> {
  try {
    const models = await listOllamaModels(endpoint);
    return { ok: true, modelCount: models.length };
  } catch (error) {
    return {
      ok: false,
      modelCount: 0,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

export interface OllamaChatRequest {
  endpoint?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  jsonMode?: boolean;
}

export async function chatWithOllama(
  request: OllamaChatRequest,
): Promise<string> {
  const base = normalizeEndpoint(request.endpoint ?? DEFAULT_OLLAMA_ENDPOINT);

  const response = await fetch(
    `${base}/api/chat`,
    ollamaRequestInit(base, {
      method: 'POST',
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        stream: false,
        ...(request.jsonMode ? { format: 'json' } : {}),
        options: {
          num_predict: request.maxTokens ?? 500,
          temperature: request.jsonMode ? 0.1 : undefined,
        },
      }),
    }),
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(formatOllamaHttpError(response.status, text));
  }

  const data = await response.json() as {
    message?: { content?: string };
  };

  const content = data.message?.content?.trim();
  if (!content) {
    throw new Error('Ollama returned an empty response');
  }

  return content;
}

const VISION_MODEL_PATTERN =
  /vision|llava|moondream|bakllava|minicpm-v|granite.*vision|qwen.*vl|gemma.*vision/i;

export function isVisionModel(modelName: string): boolean {
  return VISION_MODEL_PATTERN.test(modelName);
}

export function pickVisionModel(
  models: OllamaModel[],
  preferred?: string,
  explicitVisionModel?: string,
): string | null {
  const modelList = Array.isArray(models) ? models : [];

  if (explicitVisionModel && modelList.some((model) => model.name === explicitVisionModel)) {
    return explicitVisionModel;
  }

  if (preferred && isVisionModel(preferred) && modelList.some((model) => model.name === preferred)) {
    return preferred;
  }

  const visionModel = modelList.find((model) => isVisionModel(model.name));
  return visionModel?.name ?? null;
}

export interface OllamaVisionChatRequest {
  endpoint?: string;
  model: string;
  prompt: string;
  imageBase64: string;
  maxTokens?: number;
}

export async function chatWithOllamaVision(
  request: OllamaVisionChatRequest,
): Promise<string> {
  const base = normalizeEndpoint(request.endpoint ?? DEFAULT_OLLAMA_ENDPOINT);

  const response = await fetch(
    `${base}/api/chat`,
    ollamaRequestInit(base, {
      method: 'POST',
      body: JSON.stringify({
        model: request.model,
        messages: [
          {
            role: 'user',
            content: request.prompt,
            images: [request.imageBase64],
          },
        ],
        stream: false,
        format: 'json',
        options: {
          num_predict: request.maxTokens ?? 900,
          temperature: 0.1,
        },
      }),
    }),
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(formatOllamaHttpError(response.status, text));
  }

  const data = await response.json() as {
    message?: { content?: string };
  };

  const content = data.message?.content?.trim();
  if (!content) {
    throw new Error('Ollama vision returned an empty response');
  }

  return content;
}
