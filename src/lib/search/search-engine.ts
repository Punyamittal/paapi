import type { SearchResult, SavedAnswer, StoredDocument, VaultField } from '@/types';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreMatch(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) return 0;

  if (t === q) return 1.0;
  if (t.includes(q)) return 0.8;
  if (q.includes(t)) return 0.6;

  const queryTokens = q.split(' ');
  const textTokens = new Set(t.split(' '));
  const matches = queryTokens.filter((token) => textTokens.has(token)).length;
  return matches / queryTokens.length * 0.7;
}

const SEMANTIC_GROUPS: Record<string, string[]> = {
  college: ['university', 'institute', 'degree', 'academic', 'education', 'school'],
  phone: ['mobile', 'cell', 'contact', 'telephone', 'whatsapp'],
  resume: ['cv', 'curriculum vitae', 'biodata'],
  internship: ['intern', 'trainee', 'apprentice'],
  hackathon: ['hack', 'coding competition', 'devpost'],
};

function expandQuery(query: string): string[] {
  const terms = [query];
  const normalized = normalize(query);

  for (const [key, synonyms] of Object.entries(SEMANTIC_GROUPS)) {
    if (normalized.includes(key) || synonyms.some((s) => normalized.includes(s))) {
      terms.push(key, ...synonyms);
    }
  }

  return [...new Set(terms)];
}

export function searchVault(
  query: string,
  fields: VaultField[],
  documents: StoredDocument[],
  answers: SavedAnswer[],
): SearchResult[] {
  const expandedTerms = expandQuery(query);
  const results: SearchResult[] = [];

  for (const field of fields) {
    let bestScore = 0;
    for (const term of expandedTerms) {
      const labelScore = scoreMatch(term, field.label);
      const keyScore = scoreMatch(term, field.key);
      const valueScore = scoreMatch(term, field.value);
      bestScore = Math.max(bestScore, labelScore, keyScore, valueScore * 0.9);
    }

    if (bestScore > 0.3) {
      results.push({
        id: field.id,
        type: 'field',
        title: field.label,
        snippet: field.value.slice(0, 100),
        score: bestScore,
        profileId: field.profileId,
      });
    }
  }

  for (const doc of documents) {
    let bestScore = 0;
    for (const term of expandedTerms) {
      const nameScore = scoreMatch(term, doc.name);
      const textScore = scoreMatch(term, doc.extractedText.slice(0, 2000));
      const typeScore = scoreMatch(term, doc.type);
      bestScore = Math.max(bestScore, nameScore, textScore * 0.7, typeScore);
    }

    if (bestScore > 0.3) {
      results.push({
        id: doc.id,
        type: 'document',
        title: doc.name,
        snippet: doc.extractedText.slice(0, 100) || doc.type,
        score: bestScore,
        profileId: doc.profileId,
      });
    }
  }

  for (const answer of answers) {
    let bestScore = 0;
    for (const term of expandedTerms) {
      const titleScore = scoreMatch(term, answer.title);
      const contentScore = scoreMatch(term, answer.content.slice(0, 500));
      const tagScore = Math.max(
        ...answer.tags.map((tag) => scoreMatch(term, tag)),
        0,
      );
      bestScore = Math.max(bestScore, titleScore, contentScore * 0.8, tagScore);
    }

    if (bestScore > 0.3) {
      results.push({
        id: answer.id,
        type: 'answer',
        title: answer.title,
        snippet: answer.content.slice(0, 100),
        score: bestScore,
        profileId: answer.profileId,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
