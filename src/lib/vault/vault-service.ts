import { generateId } from '@/lib/crypto/encryption';
import {
  deriveCustomVaultKey,
  getFormFieldDisplayLabel,
  matchFieldToVaultKey,
} from '@/lib/autofill/field-matcher';
import { getDomainFromUrl, learnFieldMapping } from '@/lib/learning/field-learning';
import {
  getAllProfiles,
  getDefaultProfile,
  getFieldsByProfile,
  getMappingsByDomain,
  saveField,
  saveProfile,
} from '@/lib/storage/indexed-db';
import type {
  ExtractedField,
  FieldCategory,
  PageFormFieldDescriptor,
  Profile,
  VaultField,
} from '@/types';

export const DEFAULT_FIELD_TEMPLATES: Array<{
  key: string;
  label: string;
  category: FieldCategory;
}> = [
  { key: 'fullName', label: 'Full Name', category: 'name' },
  { key: 'fatherName', label: "Father's Name", category: 'fatherName' },
  { key: 'motherName', label: "Mother's Name", category: 'motherName' },
  { key: 'dateOfBirth', label: 'Date of Birth', category: 'dateOfBirth' },
  { key: 'aadhaar', label: 'Aadhaar Number', category: 'aadhaar' },
  { key: 'pan', label: 'PAN Number', category: 'pan' },
  { key: 'passport', label: 'Passport Number', category: 'passport' },
  { key: 'drivingLicense', label: 'Driving License', category: 'drivingLicense' },
  { key: 'email', label: 'Email Address', category: 'email' },
  { key: 'phone', label: 'Phone Number', category: 'phone' },
  { key: 'permanentAddress', label: 'Permanent Address', category: 'permanentAddress' },
  { key: 'temporaryAddress', label: 'Temporary Address', category: 'temporaryAddress' },
  { key: 'education', label: 'Education', category: 'education' },
  { key: 'skills', label: 'Skills', category: 'skills' },
  { key: 'workExperience', label: 'Work Experience', category: 'workExperience' },
  { key: 'github', label: 'GitHub URL', category: 'socialLinks' },
  { key: 'linkedin', label: 'LinkedIn URL', category: 'socialLinks' },
  { key: 'portfolio', label: 'Portfolio URL', category: 'socialLinks' },
  { key: 'emergencyContact', label: 'Emergency Contact', category: 'emergencyContact' },
];

const PROFILE_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#06b6d4', '#ef4444', '#84cc16',
];

export async function initializeDefaultProfile(): Promise<Profile> {
  const existing = await getDefaultProfile();
  if (existing) {
    await ensureProfileFields(existing.id);
    return existing;
  }

  const now = Date.now();
  const profile: Profile = {
    id: generateId(),
    name: 'Personal Profile',
    description: 'Default personal information profile',
    isDefault: true,
    color: PROFILE_COLORS[0],
    createdAt: now,
    updatedAt: now,
  };

  await saveProfile(profile);
  await ensureProfileFields(profile.id);

  return profile;
}

export async function ensureProfileFields(profileId: string): Promise<void> {
  const fields = await getFieldsByProfile(profileId);
  const existingKeys = new Set(fields.map((f) => f.key));
  const now = Date.now();

  for (const template of DEFAULT_FIELD_TEMPLATES) {
    if (existingKeys.has(template.key)) continue;

    const field: VaultField = {
      id: generateId(),
      key: template.key,
      label: template.label,
      value: '',
      category: template.category,
      profileId,
      createdAt: now,
      updatedAt: now,
    };
    await saveField(field);
  }
}

export async function createProfile(
  name: string,
  description?: string,
): Promise<Profile> {
  const profiles = await getAllProfiles();
  const now = Date.now();
  const profile: Profile = {
    id: generateId(),
    name,
    description,
    isDefault: profiles.length === 0,
    color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
    createdAt: now,
    updatedAt: now,
  };
  await saveProfile(profile);
  await ensureProfileFields(profile.id);
  return profile;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export async function updateProfile(
  id: string,
  updates: Partial<Pick<Profile, 'name' | 'description' | 'color'>>,
): Promise<Profile | undefined> {
  const profiles = asArray<Profile>(await getAllProfiles());
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return undefined;

  const updated: Profile = {
    ...profile,
    ...updates,
    updatedAt: Date.now(),
  };
  await saveProfile(updated);
  return updated;
}

export async function setDefaultProfile(id: string): Promise<void> {
  const profiles = await getAllProfiles();
  for (const profile of profiles) {
    await saveProfile({
      ...profile,
      isDefault: profile.id === id,
      updatedAt: Date.now(),
    });
  }
}

export async function getVaultData(profileId: string): Promise<Record<string, string>> {
  const fields = await getFieldsByProfile(profileId);
  const data: Record<string, string> = {};
  for (const field of fields) {
    if (field.value) {
      data[field.key] = field.value;
    }
  }
  return data;
}

export async function upsertField(
  profileId: string,
  key: string,
  label: string,
  value: string,
  category: FieldCategory = 'custom',
): Promise<VaultField> {
  const fields = asArray<VaultField>(await getFieldsByProfile(profileId));
  const existing = fields.find((f) => f.key === key);
  const now = Date.now();

  const field: VaultField = existing
    ? { ...existing, value, label, updatedAt: now }
    : {
        id: generateId(),
        key,
        label,
        value,
        category,
        profileId,
        createdAt: now,
        updatedAt: now,
      };

  await saveField(field);
  return field;
}

export async function ensureFieldSlot(
  profileId: string,
  key: string,
  label: string,
  category: FieldCategory = 'custom',
): Promise<VaultField> {
  const fields = asArray<VaultField>(await getFieldsByProfile(profileId));
  const existing = fields.find((f) => f.key === key);
  if (existing) return existing;

  const now = Date.now();
  const field: VaultField = {
    id: generateId(),
    key,
    label,
    value: '',
    category,
    profileId,
    createdAt: now,
    updatedAt: now,
  };
  await saveField(field);
  return field;
}

export async function syncFormFieldsToVault(
  profileId: string,
  pageFields: PageFormFieldDescriptor[],
  url: string,
): Promise<{ createdCount: number; createdLabels: string[]; vaultData: Record<string, string> }> {
  const domain = getDomainFromUrl(url);
  const existingFields = asArray<VaultField>(await getFieldsByProfile(profileId));
  const reservedKeys = new Set(existingFields.map((field) => field.key));
  const learnedMappings = await getMappingsByDomain(domain);
  const createdLabels: string[] = [];
  let createdCount = 0;

  for (const pageField of pageFields) {
    if (pageField.isLongAnswer) continue;

    const displayLabel = getFormFieldDisplayLabel(
      pageField.label,
      pageField.name,
      pageField.placeholder,
    );
    if (!displayLabel) continue;

    const { vaultKey, confidence } = matchFieldToVaultKey(
      pageField.label,
      pageField.name,
      pageField.placeholder,
      learnedMappings,
    );

    if (vaultKey && confidence >= 0.5) {
      await learnFieldMapping(displayLabel, pageField.name, vaultKey, url);
      continue;
    }

    const customKey = deriveCustomVaultKey(displayLabel, pageField.name, reservedKeys);
    const isNew = !reservedKeys.has(customKey);

    await ensureFieldSlot(profileId, customKey, displayLabel, 'custom');
    await learnFieldMapping(displayLabel, pageField.name, customKey, url);

    reservedKeys.add(customKey);
    if (isNew) {
      createdCount += 1;
      createdLabels.push(displayLabel);
    }
  }

  const vaultData = await getVaultData(profileId);
  return { createdCount, createdLabels, vaultData };
}

export async function applyExtractedFieldsToVault(
  profileId: string,
  fields: ExtractedField[],
): Promise<{ savedCount: number; savedFields: ExtractedField[] }> {
  const savedFields: ExtractedField[] = [];
  let savedCount = 0;

  for (const field of fields) {
    const value = field.value.trim();
    if (!value) continue;

    await upsertField(profileId, field.key, field.label, value, field.category);
    savedCount += 1;
    savedFields.push({ ...field, approved: true });
  }

  return { savedCount, savedFields };
}
