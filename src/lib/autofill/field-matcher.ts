import type { FieldCategory, FormFieldMatch, LearnedMapping } from '@/types';

/** Synonym groups for fuzzy field matching */
const FIELD_SYNONYMS: Record<string, string[]> = {
  fullName: [
    'name', 'full name', 'fullname', 'your name', 'applicant name',
    'candidate name', 'legal name', 'first and last name', 'complete name',
  ],
  firstName: ['first name', 'given name', 'fname', 'forename'],
  lastName: ['last name', 'surname', 'family name', 'lname'],
  fatherName: ["father's name", 'father name', 'fathers name', 'guardian name'],
  motherName: ["mother's name", 'mother name', 'mothers name'],
  dateOfBirth: [
    'date of birth', 'dob', 'birth date', 'birthday', 'born on',
  ],
  email: [
    'email', 'e-mail', 'email address', 'mail', 'contact email',
    'electronic mail',
  ],
  phone: [
    'phone', 'mobile', 'cell', 'telephone', 'contact number',
    'phone number', 'mobile number', 'cell phone', 'whatsapp',
    'contact no', 'tel',
  ],
  permanentAddress: [
    'permanent address', 'home address', 'residential address',
    'current address', 'address', 'street address', 'mailing address',
  ],
  temporaryAddress: [
    'temporary address', 'correspondence address', 'present address',
  ],
  aadhaar: ['aadhaar', 'aadhar', 'uid', 'uidai', 'aadhaar number'],
  pan: ['pan', 'pan number', 'pan card', 'permanent account number'],
  passport: ['passport', 'passport number', 'passport no'],
  drivingLicense: [
    'driving license', 'driving licence', 'dl number', 'license number',
  ],
  education: [
    'education', 'qualification', 'degree', 'university', 'college',
    'institute', 'school', 'academic', 'highest qualification',
  ],
  skills: ['skills', 'technical skills', 'competencies', 'expertise'],
  workExperience: [
    'experience', 'work experience', 'employment', 'job history',
    'professional experience', 'previous employment',
  ],
  github: ['github', 'github url', 'github profile', 'github link'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
  portfolio: ['portfolio', 'website', 'personal website', 'portfolio url'],
  emergencyContact: [
    'emergency contact', 'emergency number', 'alternate contact',
  ],
};

const LONG_ANSWER_PATTERNS = [
  'about yourself', 'about you', 'personal statement', 'introduction',
  'tell us about', 'describe yourself', 'why should we', 'why do you want',
  'career goals', 'cover letter', 'statement of purpose', 'motivation',
  'achievements', 'challenging project', 'leadership', 'volunteer',
  'research experience', 'hackathon', 'startup journey',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function exactSynonymMatch(label: string, vaultKey: string): number {
  const normalized = normalize(label);
  const synonyms = FIELD_SYNONYMS[vaultKey];
  if (!synonyms) return 0;

  for (const synonym of synonyms) {
    if (normalized === synonym) return 1.0;
    if (normalized.includes(synonym) || synonym.includes(normalized)) return 0.9;
  }
  return 0;
}

function fuzzySynonymMatch(label: string, vaultKey: string): number {
  const labelTokens = tokenize(label);
  const synonyms = FIELD_SYNONYMS[vaultKey];
  if (!synonyms) return 0;

  let best = 0;
  for (const synonym of synonyms) {
    const score = jaccardSimilarity(labelTokens, tokenize(synonym));
    best = Math.max(best, score);
  }
  return best;
}

export function isLongAnswerField(label: string, placeholder: string): boolean {
  const combined = normalize(`${label} ${placeholder}`);
  return LONG_ANSWER_PATTERNS.some((pattern) => combined.includes(pattern));
}

export function matchFieldToVaultKey(
  label: string,
  name: string,
  placeholder: string,
  learnedMappings: LearnedMapping[] = [],
): { vaultKey: string | null; confidence: number; isLongAnswer: boolean } {
  const combined = `${label} ${name} ${placeholder}`.trim();
  const isLongAnswer = isLongAnswerField(label, placeholder);

  if (isLongAnswer) {
    return { vaultKey: null, confidence: 0.8, isLongAnswer: true };
  }

  // Check learned mappings first (highest priority)
  for (const mapping of learnedMappings) {
    const mappingLabel = normalize(mapping.fieldLabel);
    const fieldLabel = normalize(label);
    if (mappingLabel === fieldLabel || fieldLabel.includes(mappingLabel)) {
      return {
        vaultKey: mapping.vaultKey,
        confidence: Math.min(0.95, 0.7 + mapping.hitCount * 0.05),
        isLongAnswer: false,
      };
    }
  }

  // Match against synonym dictionary
  let bestKey: string | null = null;
  let bestScore = 0;

  for (const vaultKey of Object.keys(FIELD_SYNONYMS)) {
    const exact = exactSynonymMatch(combined, vaultKey);
    const fuzzy = fuzzySynonymMatch(combined, vaultKey);
    const score = Math.max(exact, fuzzy * 0.85);

    if (score > bestScore) {
      bestScore = score;
      bestKey = vaultKey;
    }
  }

  const CONFIDENCE_THRESHOLD = 0.5;
  if (bestScore >= CONFIDENCE_THRESHOLD) {
    return { vaultKey: bestKey, confidence: bestScore, isLongAnswer: false };
  }

  return { vaultKey: null, confidence: 0, isLongAnswer: false };
}

export function buildFieldMatch(
  element: HTMLElement,
  fieldType: FormFieldMatch['fieldType'],
  label: string,
  name: string,
  placeholder: string,
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[] = [],
): FormFieldMatch {
  const { vaultKey, confidence, isLongAnswer } = matchFieldToVaultKey(
    label,
    name,
    placeholder,
    learnedMappings,
  );

  let suggestedValue: string | null = null;
  if (vaultKey && vaultData[vaultKey]) {
    suggestedValue = vaultData[vaultKey];
  }

  const needsReview = confidence > 0 && confidence < 0.75;

  return {
    element,
    fieldType,
    label,
    name,
    placeholder,
    vaultKey,
    suggestedValue,
    confidence,
    needsReview,
    isLongAnswer,
  };
}

export function categoryFromVaultKey(key: string): FieldCategory {
  const mapping: Record<string, FieldCategory> = {
    fullName: 'name',
    fatherName: 'fatherName',
    motherName: 'motherName',
    dateOfBirth: 'dateOfBirth',
    aadhaar: 'aadhaar',
    pan: 'pan',
    passport: 'passport',
    drivingLicense: 'drivingLicense',
    email: 'email',
    phone: 'phone',
    permanentAddress: 'permanentAddress',
    temporaryAddress: 'temporaryAddress',
    education: 'education',
    skills: 'skills',
    workExperience: 'workExperience',
    github: 'socialLinks',
    linkedin: 'socialLinks',
    portfolio: 'socialLinks',
    emergencyContact: 'emergencyContact',
  };
  return mapping[key] ?? 'custom';
}
