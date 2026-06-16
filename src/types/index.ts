/** Core domain types for FormVault AI */

export type FieldCategory =
  | 'name'
  | 'fatherName'
  | 'motherName'
  | 'dateOfBirth'
  | 'aadhaar'
  | 'pan'
  | 'passport'
  | 'drivingLicense'
  | 'email'
  | 'phone'
  | 'permanentAddress'
  | 'temporaryAddress'
  | 'education'
  | 'skills'
  | 'workExperience'
  | 'socialLinks'
  | 'emergencyContact'
  | 'custom';

export interface VaultField {
  id: string;
  key: string;
  label: string;
  value: string;
  category: FieldCategory;
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export type DocumentType =
  | 'resume'
  | 'aadhaar'
  | 'pan'
  | 'passport'
  | 'drivingLicense'
  | 'certificate'
  | 'marksheet'
  | 'coverLetter'
  | 'recommendation'
  | 'other';

export interface StoredDocument {
  id: string;
  name: string;
  type: DocumentType;
  mimeType: string;
  size: number;
  extractedText: string;
  extractedFields: ExtractedField[];
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  category: FieldCategory;
  confidence: number;
  approved: boolean;
}

export interface SavedAnswer {
  id: string;
  title: string;
  content: string;
  tags: string[];
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

export interface TextShortcut {
  id: string;
  trigger: string;
  expansion: string;
  label: string;
  createdAt: number;
}

export interface LearnedMapping {
  id: string;
  fieldLabel: string;
  fieldName: string;
  vaultKey: string;
  domain: string;
  hitCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface FormFieldMatch {
  element: HTMLElement;
  fieldType: 'input' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox';
  label: string;
  name: string;
  placeholder: string;
  vaultKey: string | null;
  suggestedValue: string | null;
  confidence: number;
  needsReview: boolean;
  isLongAnswer: boolean;
  availableOptions?: string[];
}

/** Target form field for AI extraction mapping */
export interface FormTargetField {
  vaultKey: string;
  label: string;
  name: string;
  placeholder: string;
  fieldType?: FormFieldMatch['fieldType'];
  options?: string[];
}

/** Serializable form field info sent to the background for vault sync */
export interface PageFormFieldDescriptor {
  label: string;
  name: string;
  placeholder: string;
  isLongAnswer: boolean;
}

export interface FillReport {
  totalFields: number;
  filledCount: number;
  reviewCount: number;
  unknownCount: number;
  matches: FormFieldMatch[];
}

export type PortalContext =
  | 'job'
  | 'scholarship'
  | 'hackathon'
  | 'college'
  | 'government'
  | 'general';

export interface AppSettings {
  autoLockMinutes: number;
  enableBiometric: boolean;
  enableTextExpansion: boolean;
  enableFloatingAssistant: boolean;
  enableSidebar: boolean;
  highContrast: boolean;
  fontSize: 'sm' | 'md' | 'lg';
  aiProvider: 'local' | 'ollama' | 'openai' | 'anthropic' | 'custom';
  aiApiKey?: string;
  aiApiEndpoint?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  ollamaVisionModel?: string;
  documentScanProvider?: 'auto' | 'ollama' | 'tesseract';
}

export interface EncryptedPayload {
  iv: string;
  salt: string;
  ciphertext: string;
}

export interface VaultBackup {
  version: string;
  exportedAt: number;
  encrypted: boolean;
  payload: EncryptedPayload | Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  type: 'field' | 'document' | 'answer' | 'profile';
  title: string;
  snippet: string;
  score: number;
  profileId?: string;
}

export interface SessionState {
  isUnlocked: boolean;
  lastActivity: number;
  activeProfileId: string | null;
}

export type MessageType =
  | 'UNLOCK_VAULT'
  | 'LOCK_VAULT'
  | 'GET_SESSION'
  | 'PING'
  | 'FILL_FORM'
  | 'SCAN_FORM'
  | 'GET_PROFILES'
  | 'SWITCH_PROFILE'
  | 'SEARCH_VAULT'
  | 'GENERATE_ANSWER'
  | 'LIST_OLLAMA_MODELS'
  | 'CHECK_OLLAMA'
  | 'RUN_OCR'
  | 'OCR_WARMUP'
  | 'EXTRACT_DOCUMENT_VISION'
  | 'SCAN_DOCUMENT_OLLAMA'
  | 'EXTRACT_PASTE_TEXT'
  | 'APPLY_EXTRACTED_TO_VAULT'
  | 'SYNC_PAGE_FORM_FIELDS'
  | 'AUTO_INIT_VAULT'
  | 'EXTRACT_FOR_PAGE'
  | 'OPEN_FORM_SCAN'
  | 'EXPORT_BACKUP'
  | 'IMPORT_BACKUP';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface GenerateAnswerRequest {
  question: string;
  context: PortalContext;
  profileId: string;
  maxLength?: number;
}

export interface GenerateAnswerResponse {
  answer: string;
  sources: string[];
}
