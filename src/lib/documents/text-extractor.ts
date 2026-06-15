import {
  DEFAULT_OLLAMA_ENDPOINT,
  isVisionModel,
  listOllamaModels,
  type OllamaModel,
} from '@/lib/ai/ollama-client';
import { categoryFromVaultKey } from '@/lib/autofill/field-matcher';
import { extractFieldsWithOllamaDirect } from '@/lib/documents/ollama-paste-extract';
import { sendExtensionMessage } from '@/lib/messaging/extension-messages';
import { getSettings } from '@/lib/storage/chrome-storage';
import type { ExtractedField, FieldCategory } from '@/types';

export { extractFieldsWithOllamaDirect } from '@/lib/documents/ollama-paste-extract';

export interface PasteExtractResult {
  ok: boolean;
  fields: ExtractedField[];
  method: 'ollama' | 'local';
  model?: string;
  error?: string;
}

function formatAadhaar(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12) return value.trim();
  return digits.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function extractSection(text: string, heading: string, maxLength = 800): string {
  const pattern = new RegExp(`\\b${heading}\\b[\\s\\S]{0,${maxLength}}`, 'i');
  const match = text.match(pattern)?.[0];
  if (!match) return '';
  return match.replace(new RegExp(`^\\b${heading}\\b`, 'i'), '').trim().slice(0, maxLength);
}

function matchLabeledRow(label: string, value: string): Partial<Record<string, string>> {
  const normalized = label.toLowerCase().replace(/\s+/g, ' ');
  const trimmed = value.trim();
  if (!trimmed) return {};

  if (/invoice\s*to|bill\s*to|customer\s*name/.test(normalized)) {
    return { fullName: trimmed.split(/\s+invoice\s+issued/i)[0].trim() };
  }
  if (/order\s*id/.test(normalized)) {
    return { orderId: trimmed };
  }
  if (/invoice\s*no|invoice\s*number/.test(normalized)) {
    return { invoiceNumber: trimmed };
  }
  if (/date\s*of\s*invoice|invoice\s*date/.test(normalized)) {
    return { publishedDate: trimmed };
  }
  if (/customer\s*address/.test(normalized)) {
    return { permanentAddress: trimmed };
  }
  if (/restaurant\s*name|vendor\s*name|seller\s*name/.test(normalized)) {
    return { companyName: trimmed };
  }
  if (/restaurant\s*gstin|vendor\s*gstin|^gstin$/.test(normalized)) {
    return { gstin: trimmed };
  }
  if (/^state$|place\s*of\s*supply/.test(normalized)) {
    return { state: trimmed };
  }
  if (/intern.*\(?\s*you\s*\)?|^intern$/.test(normalized)) {
    return { fullName: trimmed };
  }
  if (/company|employer/.test(normalized) && !/restaurant/.test(normalized)) {
    return { companyName: trimmed };
  }
  if (/platform|project/.test(normalized)) {
    return { projectName: trimmed };
  }
  if (/signatory|ceo|authorised|authorized/.test(normalized)) {
    return { signatory: trimmed };
  }
  if (/institute|university|college/.test(normalized)) {
    return { institute: trimmed };
  }
  if (/internship duration|duration|period/.test(normalized)) {
    return { internshipDuration: trimmed };
  }
  if (/date of agreement|agreement date|dated/.test(normalized)) {
    return { publishedDate: trimmed };
  }
  return {};
}

const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

function extractStandalonePhone(text: string): string | undefined {
  const pattern = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)|(?<!\d)\+\d{10,13}(?!\d)/g;
  for (const match of text.matchAll(pattern)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) {
      return match[0];
    }
  }
  return undefined;
}

function applyLabeledMappings(
  mapped: Partial<Record<string, string>>,
  add: (key: string, label: string, value: string, confidence?: number) => void,
  confidence = 0.88,
): void {
  const fieldMeta: Record<string, [string, number]> = {
    fullName: ['Full Name', 0.92],
    companyName: ['Company / Vendor', 0.9],
    projectName: ['Project / Platform', 0.86],
    signatory: ['Authorised Signatory', 0.86],
    institute: ['Institute / University', 0.88],
    internshipDuration: ['Internship Duration', 0.88],
    publishedDate: ['Invoice / Agreement Date', 0.9],
    orderId: ['Order ID', 0.93],
    invoiceNumber: ['Invoice Number', 0.93],
    permanentAddress: ['Address', 0.88],
    gstin: ['GSTIN', 0.92],
    state: ['State', 0.85],
  };

  for (const [key, value] of Object.entries(mapped)) {
    if (!value) continue;
    const meta = fieldMeta[key];
    if (meta) {
      add(key, meta[0], value, meta[1]);
    } else {
      add(key, key, value, confidence);
    }
  }
}

function extractFieldsLocally(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const seen = new Set<string>();

  const add = (key: string, label: string, value: string, confidence = 0.75) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length < 2) return;
    const dedupe = `${key}:${trimmed.slice(0, 80)}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    fields.push({
      key,
      label,
      value: trimmed,
      category: categoryFromVaultKey(key) as FieldCategory,
      confidence,
      approved: false,
    });
  };

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i)?.[0];
  if (email) add('email', 'Email Address', email, 0.9);

  const phone = extractStandalonePhone(text);
  if (phone) add('phone', 'Phone Number', phone, 0.88);

  const aadhaar = text.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/)?.[0];
  if (aadhaar) add('aadhaar', 'Aadhaar Number', formatAadhaar(aadhaar), 0.9);

  const pan = text.match(/\b[A-Z]{5}\d{4}[A-Z]\b/)?.[0];
  if (pan) add('pan', 'PAN Number', pan, 0.92);

  const doi = text.match(/\b10\.\d{4,9}\/[^\s]+/i)?.[0];
  if (doi) add('doi', 'DOI', doi.replace(/[.,;]+$/, ''), 0.95);

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const tabParts = line.split('\t');
    if (tabParts.length >= 2) {
      const mapped = matchLabeledRow(tabParts[0], tabParts.slice(1).join('\t'));
      applyLabeledMappings(mapped, add);
      continue;
    }

    const colonMatch = line.match(/^([^:]{2,60}):\s*(.+)$/);
    if (colonMatch) {
      const mapped = matchLabeledRow(colonMatch[1], colonMatch[2]);
      applyLabeledMappings(mapped, add);
    }
  }

  const invoiceTitle = lines.find((line) => /tax\s*invoice|invoice$/i.test(line));
  if (invoiceTitle) {
    add('documentTitle', 'Title', invoiceTitle, 0.9);
    add('documentType', 'Document Type', 'tax invoice', 0.85);
  }

  const invoiceTo =
    text.match(/invoice\s*to\s*:\s*(.+?)(?:\s+invoice\s+issued|\n|$)/i)?.[1]
    ?? text.match(/bill\s*to\s*:\s*(.+?)(?:\n|$)/i)?.[1];
  if (invoiceTo) {
    const name = invoiceTo.trim().split(/\s{2,}|\n/)[0].trim();
    if (name.length >= 2 && name.length < 80) {
      add('fullName', 'Customer Name', name, 0.92);
    }
  }

  const vendorLine = lines.find((line) =>
    /swiggy|zomato|amazon|flipkart|uber|issued by/i.test(line),
  );
  if (vendorLine) {
    const vendor = vendorLine.match(/(?:issued by|name:)\s*(.+)/i)?.[1]?.trim() ?? vendorLine;
    add('companyName', 'Vendor / Platform', vendor.slice(0, 120), 0.88);
  }

  const gstinMatches = [...text.matchAll(GSTIN_PATTERN)];
  for (const [index, match] of gstinMatches.entries()) {
    const before = text.slice(Math.max(0, match.index! - 40), match.index).toLowerCase();
    const label = /restaurant/.test(before)
      ? 'Restaurant GSTIN'
      : index === 0
        ? 'GSTIN'
        : `GSTIN ${index + 1}`;
    add(index === 0 ? 'gstin' : `gstin${index + 1}`, label, match[0], 0.91);
  }

  const orderId = text.match(/order\s*id\s*:\s*(\d+)/i)?.[1];
  if (orderId) add('orderId', 'Order ID', orderId, 0.94);

  const invoiceNo = text.match(/invoice\s*no\s*:\s*(\S+)/i)?.[1];
  if (invoiceNo) add('invoiceNumber', 'Invoice Number', invoiceNo, 0.94);

  const invoiceDate =
    text.match(/date\s*of\s*invoice\s*:\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i)?.[1]
    ?? text.match(/invoice\s*date\s*:\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i)?.[1];
  if (invoiceDate) add('publishedDate', 'Invoice Date', invoiceDate, 0.9);

  const customerAddress = text.match(
    /customer\s*address\s*:\s*([\s\S]+?)(?=\n\s*(?:restaurant|order\s*id|state|invoice\s*no|gstin|document)\s*:|$)/i,
  )?.[1];
  if (customerAddress) {
    add('permanentAddress', 'Customer Address', customerAddress.replace(/\s+/g, ' ').trim(), 0.87);
  }

  const subtotal = text.match(/subtotal\s+([\d,.]+)/i)?.[1];
  if (subtotal) add('invoiceSubtotal', 'Subtotal (Rs.)', subtotal, 0.86);

  const totalWords = text.match(/invoice\s*total\s*in\s*words\s+(.+)/i)?.[1];
  if (totalWords) add('invoiceTotalWords', 'Invoice Total (words)', totalWords.trim(), 0.84);

  const agreementTitle = lines.find((line) =>
    /agreement|contract|nda|non-disclosure/i.test(line),
  );
  if (agreementTitle && !invoiceTitle) {
    add('documentTitle', 'Title', agreementTitle, 0.85);
  } else if (!invoiceTitle && lines.length > 0 && lines[0].length > 3 && lines[0].length < 200) {
    add('documentTitle', 'Title', lines[0], 0.7);
  }

  if (/nda|non-disclosure|internship agreement|employment agreement/i.test(text)) {
    add('documentType', 'Document Type', 'internship agreement', 0.8);
  }

  const internName =
    text.match(/Intern\s*\(You\)\s*[\t:]\s*(.+)/i)?.[1]
    ?? text.match(/Intern\s*\(you\)\s*[\t:]\s*(.+)/i)?.[1];
  if (internName) add('fullName', 'Full Name', internName.split('\n')[0], 0.92);

  const abstract = extractSection(text, 'ABSTRACT', 900);
  if (abstract) add('abstract', 'Abstract / Summary', abstract, 0.82);

  const conclusion = extractSection(text, 'CONCLUSION', 700);
  if (conclusion) add('keyFindings', 'Key Findings', conclusion, 0.78);

  const keywords = text.match(/Index Terms[—\-:\s]+(.+)/i)?.[1]
    ?? text.match(/Keywords[—\-:\s]+(.+)/i)?.[1];
  if (keywords) add('keywords', 'Keywords / Topics', keywords.split('\n')[0], 0.85);

  if (/IEEE|arxiv|conference|journal/i.test(text)) {
    const venueLine = lines.find((line) =>
      /IEEE|International Conference|Journal|Proceedings/i.test(line),
    );
    if (venueLine) add('publicationVenue', 'Publication / Venue', venueLine, 0.8);
  }

  return fields;
}

async function listModelsWithFallback(endpoint: string): Promise<OllamaModel[]> {
  try {
    return await listOllamaModels(endpoint);
  } catch {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return [];
    const response = await sendExtensionMessage({
      type: 'LIST_OLLAMA_MODELS',
      payload: { endpoint },
    });
    return Array.isArray(response) ? (response as OllamaModel[]) : [];
  }
}

export async function resolveOllamaTextModel(): Promise<{
  endpoint: string;
  model: string;
} | null> {
  const settings = await getSettings();
  const endpoint = settings.ollamaEndpoint ?? DEFAULT_OLLAMA_ENDPOINT;
  const preferred = settings.ollamaModel?.trim();

  if (preferred && !isVisionModel(preferred)) {
    return { endpoint, model: preferred };
  }

  const models = ensureArray<OllamaModel>(await listModelsWithFallback(endpoint));
  const textModel =
    models.find((model) => !isVisionModel(model.name)) ?? models[0] ?? null;

  if (textModel) {
    return { endpoint, model: textModel.name };
  }

  if (preferred) {
    return { endpoint, model: preferred };
  }

  return null;
}

export async function extractFieldsFromPastedText(text: string): Promise<PasteExtractResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, fields: [], method: 'local', error: 'Paste some text first' };
  }

  const resolved = await resolveOllamaTextModel();
  if (resolved) {
    try {
      let fields: ExtractedField[];

      try {
        fields = await extractFieldsWithOllamaDirect({
          endpoint: resolved.endpoint,
          model: resolved.model,
          text: trimmed,
        });
      } catch (directError) {
        try {
          const fallback = await sendExtensionMessage<{
            fields?: ExtractedField[];
            error?: string;
          }>({
            type: 'EXTRACT_PASTE_TEXT',
            payload: {
              endpoint: resolved.endpoint,
              model: resolved.model,
              text: trimmed,
            },
          });

          if (fallback?.error) {
            throw new Error(fallback.error);
          }

          fields = ensureArray<ExtractedField>(fallback?.fields);
          if (fields.length === 0) {
            throw directError instanceof Error
              ? directError
              : new Error('Ollama extraction failed');
          }
        } catch {
          throw directError instanceof Error
            ? directError
            : new Error('Ollama extraction failed');
        }
      }

      return {
        ok: true,
        fields,
        method: 'ollama',
        model: resolved.model,
      };
    } catch (error) {
      const localFields = extractFieldsLocally(trimmed);
      if (localFields.length > 0) {
        return {
          ok: true,
          fields: localFields,
          method: 'local',
          error: error instanceof Error ? error.message : 'Ollama failed; used local parsing',
        };
      }

      return {
        ok: false,
        fields: [],
        method: 'local',
        error: error instanceof Error ? error.message : 'Extraction failed',
      };
    }
  }

  const localFields = extractFieldsLocally(trimmed);
  if (localFields.length > 0) {
    return { ok: true, fields: localFields, method: 'local' };
  }

  return {
    ok: false,
    fields: [],
    method: 'local',
    error: 'No Ollama model configured. Set one in Settings, or paste clearer labeled text.',
  };
}
