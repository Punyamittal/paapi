import { generateId } from '@/lib/crypto/encryption';
import { getMappingsByDomain, saveMapping } from '@/lib/storage/indexed-db';
import type { LearnedMapping } from '@/types';

export function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

export async function learnFieldMapping(
  fieldLabel: string,
  fieldName: string,
  vaultKey: string,
  url: string,
): Promise<LearnedMapping> {
  const domain = getDomainFromUrl(url);
  const existing = await getMappingsByDomain(domain);
  const match = existing.find(
    (m) =>
      m.fieldLabel.toLowerCase() === fieldLabel.toLowerCase() &&
      m.vaultKey === vaultKey,
  );

  if (match) {
    const updated: LearnedMapping = {
      ...match,
      hitCount: match.hitCount + 1,
      updatedAt: Date.now(),
    };
    await saveMapping(updated);
    return updated;
  }

  const mapping: LearnedMapping = {
    id: generateId(),
    fieldLabel,
    fieldName,
    vaultKey,
    domain,
    hitCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveMapping(mapping);
  return mapping;
}

export async function getLearnedMappingsForPage(
  url: string,
): Promise<LearnedMapping[]> {
  const domain = getDomainFromUrl(url);
  return getMappingsByDomain(domain);
}
