import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  LearnedMapping,
  Profile,
  SavedAnswer,
  StoredDocument,
  TextShortcut,
  VaultField,
} from '@/types';
import { encryptData, decryptData, generateId } from '@/lib/crypto/encryption';
import { normalizeToArrayBuffer } from '@/lib/documents/binary-transfer';

interface FormVaultDB extends DBSchema {
  profiles: {
    key: string;
    value: Profile;
  };
  fields: {
    key: string;
    value: VaultField;
    indexes: { 'by-profile': string; 'by-key': string; 'by-category': string };
  };
  documents: {
    key: string;
    value: StoredDocument;
    indexes: { 'by-profile': string; 'by-type': string };
  };
  answers: {
    key: string;
    value: SavedAnswer;
    indexes: { 'by-profile': string };
  };
  shortcuts: {
    key: string;
    value: TextShortcut;
    indexes: { 'by-trigger': string };
  };
  mappings: {
    key: string;
    value: LearnedMapping;
    indexes: { 'by-domain': string };
  };
  blobs: {
    key: string;
    value: { id: string; documentId: string; data: ArrayBuffer };
  };
}

const DB_NAME = 'formvault-ai';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FormVaultDB>> | null = null;
let encryptionPassword: string | null = null;

export function setEncryptionPassword(password: string): void {
  encryptionPassword = password;
}

export function clearEncryptionPassword(): void {
  encryptionPassword = null;
}

function getDB(): Promise<IDBPDatabase<FormVaultDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FormVaultDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('profiles', { keyPath: 'id' });

        const fields = db.createObjectStore('fields', { keyPath: 'id' });
        fields.createIndex('by-profile', 'profileId');
        fields.createIndex('by-key', 'key');
        fields.createIndex('by-category', 'category');

        const documents = db.createObjectStore('documents', { keyPath: 'id' });
        documents.createIndex('by-profile', 'profileId');
        documents.createIndex('by-type', 'type');

        const answers = db.createObjectStore('answers', { keyPath: 'id' });
        answers.createIndex('by-profile', 'profileId');

        const shortcuts = db.createObjectStore('shortcuts', { keyPath: 'id' });
        shortcuts.createIndex('by-trigger', 'trigger');

        const mappings = db.createObjectStore('mappings', { keyPath: 'id' });
        mappings.createIndex('by-domain', 'domain');

        db.createObjectStore('blobs', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

async function encryptValue(value: string): Promise<string> {
  if (!encryptionPassword) return value;
  const encrypted = await encryptData(value, encryptionPassword);
  return JSON.stringify(encrypted);
}

async function decryptValue(stored: string): Promise<string> {
  if (!encryptionPassword) return stored;
  try {
    const payload = JSON.parse(stored) as {
      iv: string;
      salt: string;
      ciphertext: string;
    };
    return await decryptData<string>(payload, encryptionPassword);
  } catch {
    return stored;
  }
}

// --- Profiles ---

export async function getAllProfiles(): Promise<Profile[]> {
  const db = await getDB();
  return db.getAll('profiles');
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  const db = await getDB();
  return db.get('profiles', id);
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const db = await getDB();
  await db.put('profiles', profile);
  return profile;
}

export async function deleteProfile(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('profiles', id);

  const fields = await db.getAllFromIndex('fields', 'by-profile', id);
  for (const field of fields) await db.delete('fields', field.id);

  const docs = await db.getAllFromIndex('documents', 'by-profile', id);
  for (const doc of docs) await db.delete('documents', doc.id);

  const answers = await db.getAllFromIndex('answers', 'by-profile', id);
  for (const answer of answers) await db.delete('answers', answer.id);
}

export async function getDefaultProfile(): Promise<Profile | undefined> {
  const db = await getDB();
  const profiles = await db.getAll('profiles');
  return profiles.find((p) => p.isDefault);
}

// --- Vault Fields ---

export async function getFieldsByProfile(profileId: string): Promise<VaultField[]> {
  const db = await getDB();
  const fields = await db.getAllFromIndex('fields', 'by-profile', profileId);
  return Promise.all(
    fields.map(async (field) => ({
      ...field,
      value: await decryptValue(field.value),
    })),
  );
}

export async function saveField(field: VaultField): Promise<VaultField> {
  const db = await getDB();
  const encrypted = {
    ...field,
    value: await encryptValue(field.value),
  };
  await db.put('fields', encrypted);
  return field;
}

export async function deleteField(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('fields', id);
}

export async function getFieldByKey(
  profileId: string,
  key: string,
): Promise<VaultField | undefined> {
  const db = await getDB();
  const fields = await db.getAllFromIndex('fields', 'by-profile', profileId);
  const match = fields.find((f) => f.key === key);
  if (!match) return undefined;
  return { ...match, value: await decryptValue(match.value) };
}

// --- Documents ---

export async function getDocumentsByProfile(
  profileId: string,
): Promise<StoredDocument[]> {
  const db = await getDB();
  return db.getAllFromIndex('documents', 'by-profile', profileId);
}

export async function saveDocument(doc: StoredDocument): Promise<StoredDocument> {
  const db = await getDB();
  await db.put('documents', doc);
  return doc;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('documents', id);
}

export async function saveDocumentBlob(
  documentId: string,
  data: ArrayBuffer,
): Promise<string> {
  const db = await getDB();
  const id = generateId();
  const copy = normalizeToArrayBuffer(data);
  await db.put('blobs', { id, documentId, data: copy });
  return id;
}

export async function getDocumentBlob(
  documentId: string,
): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  const all = await db.getAll('blobs');
  const blob = all.find((b) => b.documentId === documentId);
  return blob?.data;
}

// --- Saved Answers ---

export async function getAnswersByProfile(
  profileId: string,
): Promise<SavedAnswer[]> {
  const db = await getDB();
  return db.getAllFromIndex('answers', 'by-profile', profileId);
}

export async function saveAnswer(answer: SavedAnswer): Promise<SavedAnswer> {
  const db = await getDB();
  await db.put('answers', answer);
  return answer;
}

export async function deleteAnswer(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('answers', id);
}

// --- Text Shortcuts ---

export async function getAllShortcuts(): Promise<TextShortcut[]> {
  const db = await getDB();
  return db.getAll('shortcuts');
}

export async function saveShortcut(shortcut: TextShortcut): Promise<TextShortcut> {
  const db = await getDB();
  await db.put('shortcuts', shortcut);
  return shortcut;
}

export async function deleteShortcut(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('shortcuts', id);
}

// --- Learned Mappings ---

export async function getMappingsByDomain(
  domain: string,
): Promise<LearnedMapping[]> {
  const db = await getDB();
  return db.getAllFromIndex('mappings', 'by-domain', domain);
}

export async function saveMapping(mapping: LearnedMapping): Promise<LearnedMapping> {
  const db = await getDB();
  await db.put('mappings', mapping);
  return mapping;
}

export async function exportAllData(): Promise<Record<string, unknown>> {
  const db = await getDB();
  return {
    profiles: await db.getAll('profiles'),
    fields: await db.getAll('fields'),
    documents: await db.getAll('documents'),
    answers: await db.getAll('answers'),
    shortcuts: await db.getAll('shortcuts'),
    mappings: await db.getAll('mappings'),
  };
}

export async function importAllData(data: Record<string, unknown>): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['profiles', 'fields', 'documents', 'answers', 'shortcuts', 'mappings'],
    'readwrite',
  );

  for (const profile of (data.profiles as Profile[]) ?? []) {
    await tx.objectStore('profiles').put(profile);
  }
  for (const field of (data.fields as VaultField[]) ?? []) {
    await tx.objectStore('fields').put(field);
  }
  for (const doc of (data.documents as StoredDocument[]) ?? []) {
    await tx.objectStore('documents').put(doc);
  }
  for (const answer of (data.answers as SavedAnswer[]) ?? []) {
    await tx.objectStore('answers').put(answer);
  }
  for (const shortcut of (data.shortcuts as TextShortcut[]) ?? []) {
    await tx.objectStore('shortcuts').put(shortcut);
  }
  for (const mapping of (data.mappings as LearnedMapping[]) ?? []) {
    await tx.objectStore('mappings').put(mapping);
  }
  await tx.done;
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const stores = ['profiles', 'fields', 'documents', 'answers', 'shortcuts', 'mappings', 'blobs'] as const;
  const tx = db.transaction(stores, 'readwrite');
  for (const store of stores) {
    await tx.objectStore(store).clear();
  }
  await tx.done;
}
