import {
  chatWithOllamaVision,
  checkOllamaConnection,
  listOllamaModels,
  pickVisionModel,
  DEFAULT_OLLAMA_ENDPOINT,
  type OllamaModel,
} from '@/lib/ai/ollama-client';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/lib/documents/binary-transfer';
import { getSettings, saveSettings } from '@/lib/storage/chrome-storage';
import type { DocumentType, ExtractedField, FieldCategory } from '@/types';

const FIELD_DEFINITIONS: Array<{
  jsonKey: string;
  key: string;
  label: string;
  category: FieldCategory;
}> = [
  { jsonKey: 'fullName', key: 'fullName', label: 'Full Name', category: 'name' },
  { jsonKey: 'fatherName', key: 'fatherName', label: "Father's Name", category: 'fatherName' },
  { jsonKey: 'motherName', key: 'motherName', label: "Mother's Name", category: 'motherName' },
  { jsonKey: 'dateOfBirth', key: 'dateOfBirth', label: 'Date of Birth', category: 'dateOfBirth' },
  { jsonKey: 'gender', key: 'gender', label: 'Gender', category: 'custom' },
  { jsonKey: 'aadhaar', key: 'aadhaar', label: 'Aadhaar Number', category: 'aadhaar' },
  { jsonKey: 'pan', key: 'pan', label: 'PAN Number', category: 'pan' },
  { jsonKey: 'passport', key: 'passport', label: 'Passport Number', category: 'passport' },
  {
    jsonKey: 'drivingLicense',
    key: 'drivingLicense',
    label: 'Driving License',
    category: 'drivingLicense',
  },
  { jsonKey: 'phone', key: 'phone', label: 'Phone Number', category: 'phone' },
  { jsonKey: 'email', key: 'email', label: 'Email Address', category: 'email' },
  {
    jsonKey: 'permanentAddress',
    key: 'permanentAddress',
    label: 'Permanent Address',
    category: 'permanentAddress',
  },
];

export interface OllamaScanResult {
  ok: boolean;
  fields: ExtractedField[];
  rawText: string;
  model?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

async function listModelsWithFallback(endpoint: string): Promise<OllamaModel[]> {
  try {
    return await listOllamaModels(endpoint);
  } catch {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return [];
    }

    const response = await chrome.runtime.sendMessage({
      type: 'LIST_OLLAMA_MODELS',
      payload: { endpoint },
    });

    if (Array.isArray(response)) return response as OllamaModel[];
    return [];
  }
}

export async function resolveOllamaVisionModel(): Promise<{
  endpoint: string;
  model: string;
  source: string;
} | null> {
  const settings = await getSettings();
  const endpoint = settings.ollamaEndpoint ?? DEFAULT_OLLAMA_ENDPOINT;

  if (settings.documentScanProvider === 'tesseract') {
    return null;
  }

  const explicitVision = settings.ollamaVisionModel?.trim();
  if (explicitVision) {
    return { endpoint, model: explicitVision, source: 'settings.ollamaVisionModel' };
  }

  const check = await checkOllamaConnection(endpoint);
  if (!check.ok) {
    const swCheck = await chrome.runtime.sendMessage({
      type: 'CHECK_OLLAMA',
      payload: { endpoint },
    });
    if (!swCheck?.ok) return null;
  }

  const models = await listModelsWithFallback(endpoint);
  const picked = pickVisionModel(models, settings.ollamaModel, settings.ollamaVisionModel);
  if (picked) {
    if (!settings.ollamaVisionModel) {
      await saveSettings({ ollamaVisionModel: picked });
    }
    return { endpoint, model: picked, source: 'auto-detected vision model' };
  }

  const preferred = settings.ollamaModel?.trim();
  if (preferred && models.some((model) => model.name === preferred)) {
    return { endpoint, model: preferred, source: 'settings.ollamaModel' };
  }

  return null;
}

function buildPrompt(documentType: DocumentType, filename: string): string {
  const docLabel =
    documentType === 'aadhaar'
      ? 'Indian Aadhaar card'
      : documentType === 'pan'
        ? 'Indian PAN card'
        : documentType === 'passport'
          ? 'passport'
          : documentType === 'drivingLicense'
            ? 'driving license'
            : 'identity document';

  return `Read this ${docLabel} image (${filename}) and extract visible fields.

Return ONLY valid JSON with exactly these keys:
{
  "fullName": "",
  "fatherName": "",
  "motherName": "",
  "dateOfBirth": "",
  "gender": "",
  "aadhaar": "",
  "pan": "",
  "passport": "",
  "drivingLicense": "",
  "phone": "",
  "email": "",
  "permanentAddress": "",
  "rawText": ""
}

Rules:
- Extract ONLY text clearly visible in the image. Never guess or invent values.
- Use "" for missing fields.
- fullName must be the person's actual name, not labels like "Name" or random OCR fragments.
- aadhaar must be exactly 12 digits formatted "XXXX XXXX XXXX" when visible.
- dateOfBirth format DD/MM/YYYY when visible.
- gender must be Male or Female when visible.
- phone must be a valid phone number (10+ digits), not partial card numbers.
- rawText: all other visible text from the document.`;
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('Ollama vision did not return valid JSON');
  }
}

function cleanValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function formatAadhaar(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12) return '';
  return digits.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

function fieldsFromVisionJson(
  json: Record<string, unknown>,
  documentType: DocumentType,
): { fields: ExtractedField[]; rawText: string } {
  const fields: ExtractedField[] = [];
  const rawText = cleanValue(json.rawText);

  for (const def of FIELD_DEFINITIONS) {
    let value = cleanValue(json[def.jsonKey]);
    if (!value) continue;

    if (def.key === 'aadhaar') {
      value = formatAadhaar(value);
      if (!value) continue;
    }

    if (def.key === 'phone' && !isValidPhone(value)) continue;
    if (def.key === 'fullName' && value.length < 3) continue;

    fields.push({
      key: def.key,
      label: def.label,
      value,
      category: def.category,
      confidence: documentType === 'other' ? 0.88 : 0.94,
      approved: false,
    });
  }

  return { fields, rawText };
}

export async function extractDocumentWithOllamaVisionDirect(input: {
  endpoint: string;
  model: string;
  prompt: string;
  imageBase64: string;
}): Promise<string> {
  return chatWithOllamaVision({
    endpoint: input.endpoint,
    model: input.model,
    prompt: input.prompt,
    imageBase64: input.imageBase64,
  });
}

async function callVisionModel(input: {
  endpoint: string;
  model: string;
  prompt: string;
  imageBase64: string;
}): Promise<string> {
  try {
    return await extractDocumentWithOllamaVisionDirect(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ollama vision failed';
    const fallback = await chrome.runtime.sendMessage({
      type: 'EXTRACT_DOCUMENT_VISION',
      payload: input,
    });

    if (fallback?.error) throw new Error(fallback.error);
    if (typeof fallback?.content !== 'string') throw new Error(message);
    return fallback.content;
  }
}

export async function scanDocumentWithOllama(input: {
  data: ArrayBuffer;
  mimeType: string;
  filename: string;
  documentType: DocumentType;
}): Promise<OllamaScanResult> {
  const settings = await getSettings();

  if (settings.documentScanProvider === 'tesseract') {
    return {
      ok: false,
      skipped: true,
      reason: 'Document scanning set to Tesseract only',
      fields: [],
      rawText: '',
    };
  }

  const resolved = await resolveOllamaVisionModel();
  if (!resolved) {
    return {
      ok: false,
      skipped: true,
      reason:
        'No Ollama vision model configured. In Settings, pick a vision model or run: ollama pull llama3.2-vision',
      fields: [],
      rawText: '',
    };
  }

  try {
    const imageBase64 = arrayBufferToBase64(input.data);
    const prompt = buildPrompt(input.documentType, input.filename);
    const response = await callVisionModel({
      endpoint: resolved.endpoint,
      model: resolved.model,
      prompt,
      imageBase64,
    });

    const json = extractJsonObject(response);
    const { fields, rawText } = fieldsFromVisionJson(json, input.documentType);

    if (fields.length === 0 && !rawText) {
      return {
        ok: false,
        error: `${resolved.model} could not read fields from this image`,
        fields: [],
        rawText: '',
        model: resolved.model,
      };
    }

    return {
      ok: true,
      fields,
      rawText,
      model: resolved.model,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Ollama vision scan failed',
      fields: [],
      rawText: '',
      model: resolved.model,
    };
  }
}

export async function scanDocumentWithOllamaFromBase64(input: {
  dataBase64: string;
  mimeType: string;
  filename: string;
  documentType: DocumentType;
}): Promise<OllamaScanResult> {
  return scanDocumentWithOllama({
    data: base64ToArrayBuffer(input.dataBase64),
    mimeType: input.mimeType,
    filename: input.filename,
    documentType: input.documentType,
  });
}

// Backward-compatible helper used by older call sites.
export async function extractDocumentWithOllamaVision(input: {
  data: ArrayBuffer;
  mimeType: string;
  filename: string;
  documentType: DocumentType;
  endpoint?: string;
  model?: string;
}): Promise<{ fields: ExtractedField[]; rawText: string; model: string }> {
  const result = await scanDocumentWithOllama({
    data: input.data,
    mimeType: input.mimeType,
    filename: input.filename,
    documentType: input.documentType,
  });

  if (!result.ok) {
    throw new Error(result.error ?? result.reason ?? 'Ollama vision scan failed');
  }

  return {
    fields: result.fields,
    rawText: result.rawText,
    model: result.model ?? 'ollama',
  };
}
