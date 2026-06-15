import { chatWithOllama } from '@/lib/ai/ollama-client';
import type { ExtractedField, FieldCategory } from '@/types';

const MAX_INPUT_CHARS = 20_000;
const HEAD_CHARS = 5_500;
const TAIL_CHARS = 4_500;
const SECTION_SNIPPET_CHARS = 2_000;

export const PASTE_FIELD_DEFINITIONS: Array<{
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
  { jsonKey: 'email', key: 'email', label: 'Email Address', category: 'email' },
  { jsonKey: 'phone', key: 'phone', label: 'Phone Number', category: 'phone' },
  {
    jsonKey: 'permanentAddress',
    key: 'permanentAddress',
    label: 'Permanent Address',
    category: 'permanentAddress',
  },
  {
    jsonKey: 'temporaryAddress',
    key: 'temporaryAddress',
    label: 'Temporary Address',
    category: 'temporaryAddress',
  },
  { jsonKey: 'education', key: 'education', label: 'Education', category: 'education' },
  { jsonKey: 'institute', key: 'institute', label: 'Institute / University', category: 'education' },
  { jsonKey: 'skills', key: 'skills', label: 'Skills', category: 'skills' },
  {
    jsonKey: 'workExperience',
    key: 'workExperience',
    label: 'Work Experience',
    category: 'workExperience',
  },
  {
    jsonKey: 'internshipDuration',
    key: 'internshipDuration',
    label: 'Internship Duration',
    category: 'workExperience',
  },
  { jsonKey: 'companyName', key: 'companyName', label: 'Company / Employer', category: 'custom' },
  { jsonKey: 'projectName', key: 'projectName', label: 'Project / Platform', category: 'custom' },
  { jsonKey: 'signatory', key: 'signatory', label: 'Authorised Signatory', category: 'custom' },
  { jsonKey: 'github', key: 'github', label: 'GitHub URL', category: 'socialLinks' },
  { jsonKey: 'linkedin', key: 'linkedin', label: 'LinkedIn URL', category: 'socialLinks' },
  { jsonKey: 'portfolio', key: 'portfolio', label: 'Portfolio URL', category: 'socialLinks' },
  {
    jsonKey: 'emergencyContact',
    key: 'emergencyContact',
    label: 'Emergency Contact',
    category: 'emergencyContact',
  },
  { jsonKey: 'documentTitle', key: 'documentTitle', label: 'Title', category: 'custom' },
  { jsonKey: 'documentType', key: 'documentType', label: 'Document Type', category: 'custom' },
  { jsonKey: 'authors', key: 'authors', label: 'Authors', category: 'custom' },
  { jsonKey: 'affiliation', key: 'affiliation', label: 'Affiliation', category: 'custom' },
  { jsonKey: 'abstract', key: 'abstract', label: 'Abstract / Summary', category: 'custom' },
  { jsonKey: 'keyFindings', key: 'keyFindings', label: 'Key Findings', category: 'custom' },
  { jsonKey: 'contributions', key: 'contributions', label: 'Main Contributions', category: 'custom' },
  { jsonKey: 'methodology', key: 'methodology', label: 'Methodology', category: 'custom' },
  { jsonKey: 'dataset', key: 'dataset', label: 'Dataset / Data Source', category: 'custom' },
  { jsonKey: 'results', key: 'results', label: 'Results', category: 'custom' },
  { jsonKey: 'technologies', key: 'technologies', label: 'Technologies / Tools', category: 'skills' },
  { jsonKey: 'keywords', key: 'keywords', label: 'Keywords / Topics', category: 'custom' },
  {
    jsonKey: 'publicationVenue',
    key: 'publicationVenue',
    label: 'Publication / Venue',
    category: 'custom',
  },
  { jsonKey: 'doi', key: 'doi', label: 'DOI', category: 'custom' },
  { jsonKey: 'publishedDate', key: 'publishedDate', label: 'Published / Agreement Date', category: 'custom' },
  { jsonKey: 'orderId', key: 'orderId', label: 'Order ID', category: 'custom' },
  { jsonKey: 'invoiceNumber', key: 'invoiceNumber', label: 'Invoice Number', category: 'custom' },
  { jsonKey: 'gstin', key: 'gstin', label: 'GSTIN', category: 'custom' },
  { jsonKey: 'invoiceSubtotal', key: 'invoiceSubtotal', label: 'Invoice Subtotal', category: 'custom' },
  { jsonKey: 'invoiceTotalWords', key: 'invoiceTotalWords', label: 'Invoice Total (words)', category: 'custom' },
  { jsonKey: 'state', key: 'state', label: 'State', category: 'custom' },
  { jsonKey: 'notes', key: 'notes', label: 'Other Important Notes', category: 'custom' },
];

function cleanValue(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => cleanValue(item)).filter(Boolean);
    if (items.length === 0) return '';
    return items.map((item) => `• ${item}`).join('\n');
  }
  if (value && typeof value === 'object') {
    return cleanValue(JSON.stringify(value));
  }
  return cleanValue(value);
}

function formatAadhaar(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12) return value.trim();
  return digits.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
}

function prepareTextForExtraction(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;

  const parts: string[] = [text.slice(0, HEAD_CHARS)];

  const sectionPatterns = [
    /\bABSTRACT\b/i,
    /\bINTRODUCTION\b/i,
    /\bMETHODS?\b/i,
    /\bRESULTS?\b/i,
    /\bCONCLUSION\b/i,
    /\bREFERENCES\b/i,
    /\bSIGNATURES?\b/i,
    /\bAGREEMENT\b/i,
  ];

  for (const pattern of sectionPatterns) {
    const match = pattern.exec(text);
    if (match?.index === undefined) continue;
    const start = match.index;
    if (start < HEAD_CHARS || start > text.length - TAIL_CHARS) continue;
    parts.push(text.slice(start, start + SECTION_SNIPPET_CHARS));
  }

  parts.push(text.slice(-TAIL_CHARS));
  return parts.join('\n\n---\n\n').slice(0, MAX_INPUT_CHARS);
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
    throw new Error('Model did not return valid JSON');
  }
}

export function fieldsFromJson(json: Record<string, unknown>): ExtractedField[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return [];
  }

  const fields: ExtractedField[] = [];
  const seen = new Set<string>();

  for (const def of PASTE_FIELD_DEFINITIONS) {
    let value = normalizeFieldValue(json[def.jsonKey]);
    if (!value) continue;

    if (def.key === 'aadhaar') {
      value = formatAadhaar(value);
      if (!value) continue;
    }

    if (
      (def.key === 'abstract' || def.key === 'keyFindings' || def.key === 'methodology') &&
      value.length > 1200
    ) {
      value = `${value.slice(0, 1197)}...`;
    }

    const dedupeKey = `${def.key}:${value.slice(0, 80)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    fields.push({
      key: def.key,
      label: def.label,
      value,
      category: def.category,
      confidence: 0.93,
      approved: false,
    });
  }

  return fields;
}

export function buildExtractionPrompt(text: string): { systemPrompt: string; userPrompt: string } {
  const prepared = prepareTextForExtraction(text);
  const isLongDoc = text.length > 4_000;

  const systemPrompt =
    'You extract structured information from pasted text. The text may be a resume, ID details, ' +
    'research paper, contract, NDA, internship agreement, tax invoice, receipt, article, notes, or mixed content. ' +
    'Return ONLY valid JSON. Never invent values — use empty string for missing fields. ' +
    'Summarize long sections concisely but keep the most important facts, numbers, and names.';

  const userPrompt = `Analyze the pasted text and extract the most important information.

Return JSON with exactly these keys (use "" when not present):
{
  "documentType": "",
  "documentTitle": "",
  "authors": "",
  "affiliation": "",
  "abstract": "",
  "keyFindings": "",
  "contributions": "",
  "methodology": "",
  "dataset": "",
  "results": "",
  "technologies": "",
  "keywords": "",
  "publicationVenue": "",
  "doi": "",
  "publishedDate": "",
  "orderId": "",
  "invoiceNumber": "",
  "gstin": "",
  "invoiceSubtotal": "",
  "invoiceTotalWords": "",
  "state": "",
  "fullName": "",
  "fatherName": "",
  "motherName": "",
  "dateOfBirth": "",
  "gender": "",
  "aadhaar": "",
  "pan": "",
  "passport": "",
  "drivingLicense": "",
  "email": "",
  "phone": "",
  "permanentAddress": "",
  "temporaryAddress": "",
  "education": "",
  "institute": "",
  "skills": "",
  "workExperience": "",
  "internshipDuration": "",
  "companyName": "",
  "projectName": "",
  "signatory": "",
  "github": "",
  "linkedin": "",
  "portfolio": "",
  "emergencyContact": "",
  "notes": ""
}

Rules:
- For research papers: fill documentTitle, authors, affiliation, abstract, keyFindings, contributions, methodology, dataset, results, technologies, keywords, publicationVenue, doi.
- For contracts, NDAs, internship or employment agreements: fill documentTitle, documentType, fullName (intern/employee/party name), companyName, projectName, signatory, institute, internshipDuration, publishedDate (agreement date), and a short abstract (purpose of agreement).
- For tax invoices and receipts: fill documentTitle, documentType, fullName (customer/bill-to name), companyName (vendor/platform), permanentAddress (customer address), orderId, invoiceNumber, gstin, publishedDate (invoice date), invoiceSubtotal, invoiceTotalWords, state.
- For resumes/profiles: prioritize fullName, email, phone, education, institute, skills, workExperience.
- For ID documents: prioritize aadhaar, pan, passport, dateOfBirth, fullName.
- documentType: one of "research paper", "resume", "id document", "contract", "nda", "internship agreement", "tax invoice", "receipt", "article", "notes", "other".
- Use only information from the text. Do not guess.
${isLongDoc ? '- The text may be truncated — focus on title, parties, dates, and key terms.' : ''}

Pasted text:
---
${prepared}
---`;

  return { systemPrompt, userPrompt };
}

/** Service-worker safe — only depends on Ollama fetch, no DOM APIs. */
export async function extractFieldsWithOllamaDirect(input: {
  endpoint: string;
  model: string;
  text: string;
}): Promise<ExtractedField[]> {
  const trimmed = input.text.trim();
  if (!trimmed) {
    throw new Error('Paste some text to extract fields from');
  }

  const { systemPrompt, userPrompt } = buildExtractionPrompt(trimmed);
  const response = await chatWithOllama({
    endpoint: input.endpoint,
    model: input.model,
    systemPrompt,
    userPrompt,
    jsonMode: true,
    maxTokens: 2800,
  });

  const json = extractJsonObject(response);
  const fields = fieldsFromJson(json);

  if (fields.length === 0) {
    throw new Error('No fields could be extracted from the pasted text');
  }

  return fields;
}
