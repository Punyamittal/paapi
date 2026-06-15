import { chatWithOllama, DEFAULT_OLLAMA_ENDPOINT } from './ollama-client';
import type {
  GenerateAnswerRequest,
  GenerateAnswerResponse,
  PortalContext,
  SavedAnswer,
  VaultField,
} from '@/types';

const CONTEXT_TONES: Record<PortalContext, string> = {
  job: 'professional and results-oriented',
  scholarship: 'academic and achievement-focused',
  hackathon: 'innovative and collaborative',
  college: 'aspirational and well-rounded',
  government: 'formal and precise',
  general: 'clear and concise',
};

const QUESTION_TEMPLATES: Record<string, (data: Record<string, string>) => string> = {
  'tell us about yourself': (data) =>
    `I am ${data.fullName || 'a dedicated professional'}${data.education ? ` with a background in ${data.education}` : ''}. ${data.skills ? `My key skills include ${data.skills}.` : ''} ${data.workExperience ? `I have experience in ${data.workExperience}.` : ''}`.trim(),

  'why should we select you': (data) =>
    `With my background in ${data.skills || 'relevant skills'} and experience in ${data.workExperience || 'the field'}, I bring a unique combination of technical expertise and dedication. ${data.education ? `My education at ${data.education} has prepared me well for this opportunity.` : ''}`.trim(),

  'career goals': (data) =>
    `My career goal is to grow as a professional in ${data.skills ? `areas related to ${data.skills.split(',')[0]?.trim()}` : 'my chosen field'}, continuously learning and contributing meaningfully to every project I undertake.`.trim(),

  'describe a challenging project': (data) =>
    `One of my most challenging projects involved applying ${data.skills || 'my technical skills'} to solve a complex problem. ${data.workExperience ? `During my time at ${data.workExperience.split('\n')[0]}, I led initiatives that required both technical depth and creative problem-solving.` : 'This experience taught me resilience and the value of thorough planning.'}`.trim(),
};

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findMatchingTemplate(
  question: string,
): ((data: Record<string, string>) => string) | null {
  const normalized = normalizeQuestion(question);
  for (const [pattern, generator] of Object.entries(QUESTION_TEMPLATES)) {
    if (normalized.includes(pattern) || pattern.includes(normalized)) {
      return generator;
    }
  }
  return null;
}

function buildVaultMap(fields: VaultField[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of fields) {
    if (field.value) map[field.key] = field.value;
  }
  return map;
}

function adaptSavedAnswer(
  answer: SavedAnswer,
  context: PortalContext,
): string {
  const tone = CONTEXT_TONES[context];
  return `[${tone}] ${answer.content}`;
}

export async function generateLocalAnswer(
  request: GenerateAnswerRequest,
  fields: VaultField[],
  savedAnswers: SavedAnswer[],
  documentTexts: string[] = [],
): Promise<GenerateAnswerResponse> {
  const vaultData = buildVaultMap(fields);
  const sources: string[] = [];

  // Try saved answers first
  const matchingAnswer = savedAnswers.find((a) => {
    const q = normalizeQuestion(request.question);
    return a.tags.some((tag) => q.includes(tag.toLowerCase())) ||
      normalizeQuestion(a.title).includes(q) ||
      q.includes(normalizeQuestion(a.title));
  });

  if (matchingAnswer) {
    sources.push(`Saved answer: ${matchingAnswer.title}`);
    return {
      answer: adaptSavedAnswer(matchingAnswer, request.context),
      sources,
    };
  }

  // Try template-based generation
  const template = findMatchingTemplate(request.question);
  if (template) {
    sources.push('Profile data');
    let answer = template(vaultData);

    // Enrich with document context
    if (documentTexts.length > 0) {
      const resumeText = documentTexts[0].slice(0, 500);
      sources.push('Resume/document');
      answer += ` ${resumeText.slice(0, 200)}...`;
    }

    if (request.maxLength && answer.length > request.maxLength) {
      answer = answer.slice(0, request.maxLength - 3) + '...';
    }

    return { answer, sources };
  }

  // Generic fallback using available profile data
  sources.push('Profile data');
  const tone = CONTEXT_TONES[request.context];
  const parts: string[] = [];

  if (vaultData.fullName) parts.push(`As ${vaultData.fullName}`);
  if (vaultData.education) parts.push(`with educational background in ${vaultData.education}`);
  if (vaultData.skills) parts.push(`skilled in ${vaultData.skills}`);
  if (vaultData.workExperience) parts.push(`with professional experience in ${vaultData.workExperience.split('\n')[0]}`);

  let answer = parts.length > 0
    ? `${parts.join(', ')}, I am well-suited for this opportunity. My approach is ${tone}.`
    : `Based on my profile, I believe I am a strong candidate. My response is ${tone}.`;

  if (request.maxLength && answer.length > request.maxLength) {
    answer = answer.slice(0, request.maxLength - 3) + '...';
  }

  return { answer, sources };
}

function buildPromptContext(
  request: GenerateAnswerRequest,
  fields: VaultField[],
  documentTexts: string[] = [],
): { systemPrompt: string; userPrompt: string; vaultData: Record<string, string> } {
  const vaultData = buildVaultMap(fields);
  const tone = CONTEXT_TONES[request.context];

  const systemPrompt =
    `You are a privacy-first form assistant. Generate a ${tone} answer for a web form question. ` +
    'Use ONLY the profile data and document excerpts provided. Do not invent employers, degrees, ' +
    'awards, or contact details. If information is missing, write naturally without fabricating facts.';

  const documentSection =
    documentTexts.length > 0
      ? `\n\nDocument excerpts:\n${documentTexts
          .slice(0, 2)
          .map((text, index) => `[Document ${index + 1}]\n${text.slice(0, 1500)}`)
          .join('\n\n')}`
      : '';

  const userPrompt =
    `Question: ${request.question}\n\n` +
    `Application context: ${request.context}\n\n` +
    `Profile data:\n${JSON.stringify(vaultData, null, 2)}` +
    documentSection +
    (request.maxLength ? `\n\nKeep the answer under ${request.maxLength} characters.` : '');

  return { systemPrompt, userPrompt, vaultData };
}

export async function generateAnswerWithOllama(
  request: GenerateAnswerRequest,
  fields: VaultField[],
  savedAnswers: SavedAnswer[],
  documentTexts: string[] = [],
  endpoint = DEFAULT_OLLAMA_ENDPOINT,
  model: string,
): Promise<GenerateAnswerResponse> {
  if (!model) {
    throw new Error('No Ollama model selected');
  }

  const { systemPrompt, userPrompt } = buildPromptContext(request, fields, documentTexts);

  try {
    const answer = await chatWithOllama({
      endpoint,
      model,
      systemPrompt,
      userPrompt,
      maxTokens: request.maxLength ? Math.ceil(request.maxLength / 3) : 500,
    });

    return {
      answer: request.maxLength && answer.length > request.maxLength
        ? `${answer.slice(0, request.maxLength - 3)}...`
        : answer,
      sources: ['Ollama (local)', 'Profile data', ...(documentTexts.length ? ['Documents'] : [])],
    };
  } catch {
    return generateLocalAnswer(request, fields, savedAnswers, documentTexts);
  }
}

export async function generateAnswerWithAPI(
  request: GenerateAnswerRequest,
  fields: VaultField[],
  apiKey: string,
  endpoint: string,
): Promise<GenerateAnswerResponse> {
  const { systemPrompt, userPrompt } = buildPromptContext(request, fields);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: request.maxLength ? Math.ceil(request.maxLength / 3) : 500,
      }),
    });

    if (!response.ok) throw new Error('API request failed');

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    return {
      answer: data.choices[0]?.message.content ?? '',
      sources: ['AI API', 'Profile data'],
    };
  } catch {
    return generateLocalAnswer(request, fields, []);
  }
}
