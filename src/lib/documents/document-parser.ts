import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { normalizeToArrayBuffer, arrayBufferToBase64 } from '@/lib/documents/binary-transfer';
import { extractTextFromImage } from '@/lib/documents/ocr-client';
import type { OllamaScanResult } from '@/lib/documents/ollama-document-extractor';
import { getSettings } from '@/lib/storage/chrome-storage';
import { categoryFromVaultKey } from '@/lib/autofill/field-matcher';
import { generateId } from '@/lib/crypto/encryption';
import type { DocumentType, ExtractedField, FieldCategory } from '@/types';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export async function extractTextFromPDF(data: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push(text);
  }

  return pages.join('\n\n');
}

export async function extractTextFromDOCX(data: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: data });
  return result.value;
}

export async function extractTextFromPlainText(data: ArrayBuffer): Promise<string> {
  return new TextDecoder().decode(data);
}

function inferMimeType(filename: string, mimeType: string): string {
  if (mimeType) return mimeType;
  if (/\.pdf$/i.test(filename)) return 'application/pdf';
  if (/\.docx$/i.test(filename)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (/\.txt$/i.test(filename)) return 'text/plain';
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  return mimeType;
}

export function detectDocumentType(filename: string, mimeType: string): DocumentType {
  const lower = filename.toLowerCase();

  if (/resume|cv/i.test(lower)) return 'resume';
  if (/aadhaar|aadhar/i.test(lower)) return 'aadhaar';
  if (/pan/i.test(lower)) return 'pan';
  if (/passport/i.test(lower)) return 'passport';
  if (/driving|license|licence/i.test(lower)) return 'drivingLicense';
  if (/certificate|cert/i.test(lower)) return 'certificate';
  if (/marksheet|mark.?sheet|transcript/i.test(lower)) return 'marksheet';
  if (/cover.?letter/i.test(lower)) return 'coverLetter';
  if (/recommend/i.test(lower)) return 'recommendation';

  if (mimeType.includes('pdf')) return 'other';
  return 'other';
}

export async function parseDocument(
  filename: string,
  mimeType: string,
  data: ArrayBuffer,
): Promise<{ text: string; type: DocumentType; ocrError?: string }> {
  const resolvedMime = inferMimeType(filename, mimeType);
  const type = detectDocumentType(filename, resolvedMime);
  let text = '';
  let ocrError: string | undefined;

  if (resolvedMime === 'application/pdf' || filename.endsWith('.pdf')) {
    text = await extractTextFromPDF(data);
  } else if (
    resolvedMime.includes('wordprocessingml') ||
    filename.endsWith('.docx')
  ) {
    text = await extractTextFromDOCX(data);
  } else if (resolvedMime.startsWith('text/') || filename.endsWith('.txt')) {
    text = await extractTextFromPlainText(data);
  } else if (
    resolvedMime.startsWith('image/') ||
    /\.(png|jpe?g|webp|bmp|gif)$/i.test(filename)
  ) {
    try {
      const hint =
        type === 'aadhaar' ||
        type === 'pan' ||
        type === 'passport' ||
        type === 'drivingLicense'
          ? 'id-card'
          : 'default';
      text = await extractTextFromImage(data, resolvedMime, filename, hint);
    } catch (error) {
      ocrError = error instanceof Error ? error.message : 'OCR failed';
      text = '';
    }
  }

  return { text: text.trim(), type, ocrError };
}

const EXTRACTION_PATTERNS: Array<{
  key: string;
  label: string;
  pattern: RegExp;
  confidence?: number;
}> = [
  {
    key: 'email',
    label: 'Email Address',
    pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/gi,
    confidence: 0.95,
  },
  {
    key: 'phone',
    label: 'Phone Number',
    pattern: /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4,5}|\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,
    confidence: 0.9,
  },
  {
    key: 'aadhaar',
    label: 'Aadhaar Number',
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    confidence: 0.92,
  },
  {
    key: 'pan',
    label: 'PAN Number',
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    confidence: 0.95,
  },
  {
    key: 'passport',
    label: 'Passport Number',
    pattern: /\b[A-Z]\d{7,8}\b/g,
    confidence: 0.75,
  },
  {
    key: 'drivingLicense',
    label: 'Driving License',
    pattern: /\b(?:DL|dl)[-\s]?[A-Z]{2}[-\s]?\d{2}[-\s]?\d{4,12}\b/g,
    confidence: 0.8,
  },
  {
    key: 'github',
    label: 'GitHub URL',
    pattern: /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/gi,
    confidence: 0.9,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn URL',
    pattern: /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/gi,
    confidence: 0.9,
  },
  {
    key: 'portfolio',
    label: 'Portfolio URL',
    pattern: /(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:dev|io|me|com)\/?[\w./-]*/gi,
    confidence: 0.6,
  },
  {
    key: 'dateOfBirth',
    label: 'Date of Birth',
    pattern: /\b(?:0?[1-9]|[12]\d|3[01])[\/\-](?:0?[1-9]|1[0-2])[\/\-](?:19|20)\d{2}\b/g,
    confidence: 0.85,
  },
];

const LABELED_FIELD_PATTERNS: Array<{
  key: string;
  label: string;
  patterns: RegExp[];
  confidence?: number;
}> = [
  {
    key: 'fullName',
    label: 'Full Name',
    patterns: [
      /(?:full\s*name|name|candidate\s*name|applicant\s*name)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.9,
  },
  {
    key: 'fatherName',
    label: "Father's Name",
    patterns: [
      /(?:father'?s?\s*name|father)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.9,
  },
  {
    key: 'motherName',
    label: "Mother's Name",
    patterns: [
      /(?:mother'?s?\s*name|mother)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.9,
  },
  {
    key: 'dateOfBirth',
    label: 'Date of Birth',
    patterns: [
      /(?:date\s*of\s*birth|dob|birth\s*date|born\s*on)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.92,
  },
  {
    key: 'email',
    label: 'Email Address',
    patterns: [
      /(?:e-?mail|email\s*address|mail)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.95,
  },
  {
    key: 'phone',
    label: 'Phone Number',
    patterns: [
      /(?:phone|mobile|contact\s*(?:no|number)?|tel(?:ephone)?|whatsapp)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.92,
  },
  {
    key: 'permanentAddress',
    label: 'Permanent Address',
    patterns: [
      /(?:permanent\s*address|home\s*address|residential\s*address|address)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.85,
  },
  {
    key: 'temporaryAddress',
    label: 'Temporary Address',
    patterns: [
      /(?:temporary\s*address|correspondence\s*address|present\s*address)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.85,
  },
  {
    key: 'aadhaar',
    label: 'Aadhaar Number',
    patterns: [
      /(?:aadhaar|aadhar|uid(?:ai)?)\s*(?:no|number)?\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.95,
  },
  {
    key: 'pan',
    label: 'PAN Number',
    patterns: [
      /(?:pan(?:\s*card)?|permanent\s*account\s*number)\s*(?:no|number)?\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.95,
  },
  {
    key: 'passport',
    label: 'Passport Number',
    patterns: [
      /(?:passport)\s*(?:no|number)?\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.9,
  },
  {
    key: 'drivingLicense',
    label: 'Driving License',
    patterns: [
      /(?:driving\s*licen[cs]e|dl\s*number)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.9,
  },
  {
    key: 'education',
    label: 'Education',
    patterns: [
      /(?:education|qualification|degree|highest\s*qualification)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.8,
  },
  {
    key: 'skills',
    label: 'Skills',
    patterns: [
      /(?:skills|technical\s*skills|competencies)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.8,
  },
  {
    key: 'workExperience',
    label: 'Work Experience',
    patterns: [
      /(?:work\s*experience|experience|employment\s*history)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.8,
  },
  {
    key: 'emergencyContact',
    label: 'Emergency Contact',
    patterns: [
      /(?:emergency\s*contact|alternate\s*contact)\s*[:\-]\s*(.+)/i,
    ],
    confidence: 0.85,
  },
];

const SECTION_HEADERS = [
  'education',
  'qualification',
  'skills',
  'technical skills',
  'experience',
  'work experience',
  'employment',
  'projects',
  'certifications',
  'contact',
  'personal details',
  'summary',
  'objective',
];

function cleanExtractedValue(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\|.*$/, '')
    .trim();
}

function isLikelySectionHeader(line: string): boolean {
  const normalized = line.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  return SECTION_HEADERS.some(
    (header) => normalized === header || normalized.startsWith(`${header} `),
  );
}

function extractSectionBlock(text: string, headers: string[]): string | null {
  const lines = text.split('\n');
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const normalized = line.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    if (headers.some((h) => normalized === h || normalized.startsWith(`${h} `))) {
      start = i + 1;
      break;
    }
  }

  if (start === -1) return null;

  const block: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (block.length > 0) break;
      continue;
    }
    if (isLikelySectionHeader(line) && block.length > 0) break;
    block.push(line);
    if (block.join(' ').length > 1200) break;
  }

  const value = block.join('\n').trim();
  return value.length >= 3 ? value : null;
}

function addField(
  fields: ExtractedField[],
  seen: Set<string>,
  field: Omit<ExtractedField, 'approved'>,
): void {
  const value = cleanExtractedValue(field.value);
  if (!value || value.length > 2000) return;

  const dedupeKey = `${field.key}:${value.toLowerCase()}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);

  fields.push({
    ...field,
    value,
    category: field.category ?? (categoryFromVaultKey(field.key) as FieldCategory),
    approved: false,
  });
}

function extractLabeledFields(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const seen = new Set<string>();
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const { key, label, patterns, confidence = 0.88 } of LABELED_FIELD_PATTERNS) {
      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (!match?.[1]) continue;
        addField(fields, seen, {
          key,
          label,
          value: match[1],
          category: categoryFromVaultKey(key) as FieldCategory,
          confidence,
        });
      }
    }
  }

  return fields;
}

function extractSectionFields(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const seen = new Set<string>();

  const education = extractSectionBlock(text, ['education', 'qualification', 'academic background']);
  if (education) {
    addField(fields, seen, {
      key: 'education',
      label: 'Education',
      value: education,
      category: 'education',
      confidence: 0.82,
    });
  }

  const skills = extractSectionBlock(text, ['skills', 'technical skills', 'core competencies']);
  if (skills) {
    addField(fields, seen, {
      key: 'skills',
      label: 'Skills',
      value: skills,
      category: 'skills',
      confidence: 0.82,
    });
  }

  const experience = extractSectionBlock(text, [
    'work experience',
    'experience',
    'employment history',
    'professional experience',
  ]);
  if (experience) {
    addField(fields, seen, {
      key: 'workExperience',
      label: 'Work Experience',
      value: experience,
      category: 'workExperience',
      confidence: 0.82,
    });
  }

  return fields;
}

function mergeFieldsByKey(fields: ExtractedField[]): ExtractedField[] {
  const byKey = new Map<string, ExtractedField>();

  for (const field of fields) {
    const existing = byKey.get(field.key);
    if (!existing || field.confidence > existing.confidence) {
      byKey.set(field.key, field);
    }
  }

  return [...byKey.values()];
}

function normalizeOcrDigits(value: string): string {
  return value
    .replace(/[OoQ]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/\D/g, '');
}

function extractAadhaarNumber(text: string): string | null {
  const spaced = text.match(/\b[\dOoQIl|SsBbZz]{4}[\s-]?[\dOoQIl|SsBbZz]{4}[\s-]?[\dOoQIl|SsBbZz]{4}\b/);
  if (spaced) {
    const digits = normalizeOcrDigits(spaced[0]);
    if (digits.length === 12) {
      return digits.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
    }
  }

  const compact = normalizeOcrDigits(text);
  const match = compact.match(/\d{12}/);
  if (match) {
    return match[0].replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
  }

  return null;
}

function extractAadhaarFields(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const seen = new Set<string>();

  const aadhaar = extractAadhaarNumber(text);
  if (aadhaar) {
    addField(fields, seen, {
      key: 'aadhaar',
      label: 'Aadhaar Number',
      value: aadhaar,
      category: 'aadhaar',
      confidence: 0.94,
    });
  }

  const dobMatch = text.match(
    /\b(?:DOB|Date of Birth|जन्म\s*तिथि)?\s*[:\-]?\s*((?:0?[1-9]|[12]\d|3[01])[\/\-](?:0?[1-9]|1[0-2])[\/\-](?:19|20)\d{2})\b/i,
  );
  if (dobMatch?.[1]) {
    addField(fields, seen, {
      key: 'dateOfBirth',
      label: 'Date of Birth',
      value: dobMatch[1],
      category: 'dateOfBirth',
      confidence: 0.9,
    });
  }

  const genderMatch = text.match(/\b(MALE|FEMALE|Male|Female|M|F|पुरुष|महिला)\b/);
  if (genderMatch?.[1]) {
    const raw = genderMatch[1].toLowerCase();
    const gender =
      raw.startsWith('m') || raw.includes('pur') ? 'Male' : 'Female';
    addField(fields, seen, {
      key: 'gender',
      label: 'Gender',
      value: gender,
      category: 'custom',
      confidence: 0.82,
    });
  }

  const nameMatch = text.match(/(?:Name|नाम)\s*[:\-]?\s*([A-Za-z][A-Za-z\s.'-]{2,60})/i);
  if (nameMatch?.[1]) {
    addField(fields, seen, {
      key: 'fullName',
      label: 'Full Name',
      value: nameMatch[1],
      category: 'name',
      confidence: 0.86,
    });
  }

  return fields;
}

export function extractFieldsFromText(
  text: string,
  documentType: DocumentType = 'other',
): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const seen = new Set<string>();

  for (const { key, label, pattern, confidence = 0.85 } of EXTRACTION_PATTERNS) {
    const matches = text.match(pattern);
    if (!matches) continue;

    for (const match of matches) {
      addField(fields, seen, {
        key,
        label,
        value: match,
        category: categoryFromVaultKey(key) as FieldCategory,
        confidence,
      });
    }
  }

  for (const labeled of extractLabeledFields(text)) {
    addField(fields, seen, labeled);
  }

  for (const sectionField of extractSectionFields(text)) {
    addField(fields, seen, sectionField);
  }

  if (documentType === 'aadhaar') {
    for (const aadhaarField of extractAadhaarFields(text)) {
      addField(fields, seen, aadhaarField);
    }
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (
    lines.length > 0 &&
    lines[0].length < 60 &&
    !lines[0].includes('@') &&
    !fields.some((f) => f.key === 'fullName')
  ) {
    addField(fields, seen, {
      key: 'fullName',
      label: 'Full Name',
      value: lines[0],
      category: 'name',
      confidence: documentType === 'resume' ? 0.75 : 0.6,
    });
  }

  return mergeFieldsByKey(fields);
}

export async function processUploadedDocument(
  file: File,
): Promise<{
  name: string;
  type: DocumentType;
  mimeType: string;
  size: number;
  extractedText: string;
  extractedFields: ExtractedField[];
  blob: ArrayBuffer;
  ocrError?: string;
  scanMethod?: 'ollama' | 'tesseract';
  scanModel?: string;
  scanFallbackReason?: string;
}> {
  const blob = await file.arrayBuffer();
  const storageBlob = normalizeToArrayBuffer(blob);
  const mimeType = file.type || inferMimeType(file.name, file.type);
  const type = detectDocumentType(file.name, mimeType);
  const isImage =
    mimeType.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);

  let extractedText = '';
  let extractedFields: ExtractedField[] = [];
  let ocrError: string | undefined;
  let scanMethod: 'ollama' | 'tesseract' | undefined;
  let scanModel: string | undefined;
  let scanFallbackReason: string | undefined;

  if (isImage) {
    const settings = await getSettings();
    const preferOllama = settings.documentScanProvider !== 'tesseract';

    if (preferOllama) {
      let ollamaResult: OllamaScanResult | null = null;

      try {
        ollamaResult = await chrome.runtime.sendMessage({
          type: 'SCAN_DOCUMENT_OLLAMA',
          payload: {
            dataBase64: arrayBufferToBase64(storageBlob),
            mimeType,
            filename: file.name,
            documentType: type,
          },
        });
      } catch (error) {
        ocrError = error instanceof Error ? error.message : 'Ollama scan request failed';
      }

      if (ollamaResult?.ok) {
        extractedText = ollamaResult.rawText;
        extractedFields = ollamaResult.fields;
        scanMethod = 'ollama';
        scanModel = ollamaResult.model;
      } else if (ollamaResult?.skipped) {
        scanFallbackReason = ollamaResult.reason;
        if (settings.documentScanProvider === 'ollama') {
          ocrError = ollamaResult.reason ?? 'Ollama vision is not configured';
        }
      } else if (ollamaResult?.error) {
        ocrError = ollamaResult.error;
        scanFallbackReason = ollamaResult.error;
        if (settings.documentScanProvider === 'ollama') {
          // Do not fall back to Tesseract when user asked for Ollama only.
        }
      }
    }
  }

  const settings = await getSettings();
  const allowTesseractFallback =
    settings.documentScanProvider !== 'ollama' &&
    isImage &&
    extractedFields.length === 0 &&
    !extractedText.trim();

  if (allowTesseractFallback) {
    try {
      const { text, type: parsedType, ocrError: tesseractError } = await parseDocument(
        file.name,
        file.type,
        blob,
      );
      extractedText = text;
      extractedFields = extractFieldsFromText(text, parsedType);
      scanMethod = 'tesseract';
      if (tesseractError && !ocrError) ocrError = tesseractError;
    } catch (error) {
      ocrError = error instanceof Error ? error.message : 'Document scan failed';
    }
  } else if (!isImage) {
    const { text, type: parsedType, ocrError: parseError } = await parseDocument(
      file.name,
      file.type,
      blob,
    );
    extractedText = text;
    extractedFields = extractFieldsFromText(text, parsedType);
    if (parseError) ocrError = parseError;
  }

  return {
    name: file.name,
    type,
    mimeType,
    size: file.size,
    extractedText,
    extractedFields,
    blob: storageBlob,
    ocrError: extractedFields.length > 0 ? undefined : ocrError,
    scanMethod,
    scanModel,
    scanFallbackReason,
  };
}

export function createDocumentRecord(
  processed: Awaited<ReturnType<typeof processUploadedDocument>>,
  profileId: string,
): import('@/types').StoredDocument {
  const now = Date.now();
  return {
    id: generateId(),
    name: processed.name,
    type: processed.type,
    mimeType: processed.mimeType,
    size: processed.size,
    extractedText: processed.extractedText,
    extractedFields: processed.extractedFields,
    profileId,
    createdAt: now,
    updatedAt: now,
  };
}
