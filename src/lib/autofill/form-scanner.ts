import { buildFieldMatch } from './field-matcher';
import type { FillReport, FormFieldMatch, LearnedMapping } from '@/types';

function getFieldLabel(element: HTMLElement): string {
  const id = element.getAttribute('id');
  if (id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (labelEl?.textContent) return labelEl.textContent.trim();
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const parentLabel = element.closest('label');
  if (parentLabel?.textContent) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, textarea, select').forEach((el) => el.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  const prev = element.previousElementSibling;
  if (prev?.tagName === 'LABEL' && prev.textContent) {
    return prev.textContent.trim();
  }

  return '';
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (element.getAttribute('type') === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function scanInputs(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[],
): FormFieldMatch[] {
  const matches: FormFieldMatch[] = [];
  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="image"])',
  );

  for (const input of inputs) {
    if (!isVisible(input)) continue;
    const type = input.type;
    const fieldType: FormFieldMatch['fieldType'] =
      type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'input';

    matches.push(
      buildFieldMatch(
        input,
        fieldType,
        getFieldLabel(input),
        input.name,
        input.placeholder,
        vaultData,
        learnedMappings,
      ),
    );
  }
  return matches;
}

function scanTextareas(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[],
): FormFieldMatch[] {
  const matches: FormFieldMatch[] = [];
  const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');

  for (const textarea of textareas) {
    if (!isVisible(textarea)) continue;
    matches.push(
      buildFieldMatch(
        textarea,
        'textarea',
        getFieldLabel(textarea),
        textarea.name,
        textarea.placeholder,
        vaultData,
        learnedMappings,
      ),
    );
  }
  return matches;
}

function scanSelects(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[],
): FormFieldMatch[] {
  const matches: FormFieldMatch[] = [];
  const selects = document.querySelectorAll<HTMLSelectElement>('select');

  for (const select of selects) {
    if (!isVisible(select)) continue;
    matches.push(
      buildFieldMatch(
        select,
        'select',
        getFieldLabel(select),
        select.name,
        '',
        vaultData,
        learnedMappings,
      ),
    );
  }
  return matches;
}

export function scanFormFields(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[] = [],
): FormFieldMatch[] {
  return [
    ...scanInputs(vaultData, learnedMappings),
    ...scanTextareas(vaultData, learnedMappings),
    ...scanSelects(vaultData, learnedMappings),
  ];
}

export function fillField(match: FormFieldMatch, value: string): boolean {
  const { element, fieldType } = match;

  try {
    if (fieldType === 'input' || fieldType === 'textarea') {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        fieldType === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(input, value);
      } else {
        input.value = value;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (fieldType === 'select') {
      const select = element as HTMLSelectElement;
      const option = [...select.options].find(
        (o) =>
          o.value.toLowerCase() === value.toLowerCase() ||
          o.text.toLowerCase().includes(value.toLowerCase()),
      );
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    if (fieldType === 'checkbox' || fieldType === 'radio') {
      const input = element as HTMLInputElement;
      if (value.toLowerCase() === 'true' || value.toLowerCase() === 'yes') {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export function fillForm(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[] = [],
): FillReport {
  const matches = scanFormFields(vaultData, learnedMappings);
  let filledCount = 0;
  let reviewCount = 0;
  let unknownCount = 0;

  for (const match of matches) {
    if (match.isLongAnswer) {
      reviewCount++;
      continue;
    }

    if (match.suggestedValue && match.confidence >= 0.5) {
      if (match.needsReview) {
        reviewCount++;
      }
      const filled = fillField(match, match.suggestedValue);
      if (filled) {
        filledCount++;
        highlightField(match.element, match.needsReview ? 'review' : 'filled');
      }
    } else {
      unknownCount++;
      highlightField(match.element, 'unknown');
    }
  }

  return {
    totalFields: matches.length,
    filledCount,
    reviewCount,
    unknownCount,
    matches,
  };
}

export function highlightField(
  element: HTMLElement,
  status: 'filled' | 'review' | 'unknown',
): void {
  const colors = {
    filled: 'rgba(16, 185, 129, 0.15)',
    review: 'rgba(245, 158, 11, 0.15)',
    unknown: 'rgba(239, 68, 68, 0.1)',
  };
  const borders = {
    filled: '2px solid rgba(16, 185, 129, 0.5)',
    review: '2px solid rgba(245, 158, 11, 0.5)',
    unknown: '2px solid rgba(239, 68, 68, 0.3)',
  };

  element.style.backgroundColor = colors[status];
  element.style.outline = borders[status];
  element.style.transition = 'background-color 0.3s, outline 0.3s';
  element.dataset.formvaultHighlight = status;
}

export function clearHighlights(): void {
  document.querySelectorAll('[data-formvault-highlight]').forEach((el) => {
    const element = el as HTMLElement;
    element.style.backgroundColor = '';
    element.style.outline = '';
    delete element.dataset.formvaultHighlight;
  });
}

export function detectPortalContext(): import('@/types').PortalContext {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const combined = `${url} ${title}`;

  if (/linkedin|indeed|naukri|glassdoor|monster|career|job|hire|recruit/.test(combined)) {
    return 'job';
  }
  if (/scholarship|grant|fellowship|fund/.test(combined)) {
    return 'scholarship';
  }
  if (/hackathon|devpost|hack/.test(combined)) {
    return 'hackathon';
  }
  if (/admission|university|college|apply|campus/.test(combined)) {
    return 'college';
  }
  if (/gov\.|government|uidai|incometax|passport/.test(combined)) {
    return 'government';
  }
  return 'general';
}
