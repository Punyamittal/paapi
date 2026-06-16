import { buildFieldMatch, getFormFieldDisplayLabel, matchFieldToVaultKey } from './field-matcher';
import {
  fillDropdownElementAsync,
  fillNativeSelect,
  findAssociatedSelect,
  getNativeSelectOptions,
  type SelectOption,
} from './select-filler';
import type { FillReport, FormFieldMatch, FormTargetField, LearnedMapping } from '@/types';

function getFieldLabel(element: HTMLElement): string {
  const id = element.getAttribute('id');
  if (id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (labelEl?.textContent) return labelEl.textContent.trim();
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelParts = labelledBy
      .split(/\s+/)
      .map((labelId) => document.getElementById(labelId)?.textContent?.trim())
      .filter(Boolean);
    if (labelParts.length > 0) return labelParts.join(' ');
  }

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

  const container = element.closest('.form-group, .field, .input-group, [class*="form"]');
  if (container) {
    const containerLabel = container.querySelector('label, .label, .form-label');
    if (containerLabel?.textContent) {
      return containerLabel.textContent.trim();
    }
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

function getSelectOptionsFromElement(element: HTMLElement): string[] {
  if (element instanceof HTMLSelectElement) {
    return getNativeSelectOptions(element).map((option) => option.text);
  }

  const associated =
    element.querySelector('select')
    ?? element.closest('div, fieldset, .form-group, .field')?.querySelector('select');
  if (associated instanceof HTMLSelectElement) {
    return getNativeSelectOptions(associated).map((option) => option.text);
  }

  const datalistId = element.getAttribute('list');
  if (datalistId) {
    const options = document.getElementById(datalistId)?.querySelectorAll('option') ?? [];
    return [...options].map((option) => option.value.trim()).filter(Boolean);
  }

  return [];
}

function buildMatch(
  element: HTMLElement,
  fieldType: FormFieldMatch['fieldType'],
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[],
): FormFieldMatch {
  const label = getFieldLabel(element);
  const name = element.getAttribute('name') ?? '';
  const placeholder =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.placeholder
      : element.getAttribute('placeholder') ?? '';

  const match = buildFieldMatch(
    element,
    fieldType,
    label,
    name,
    placeholder,
    vaultData,
    learnedMappings,
  );

  const options = getSelectOptionsFromElement(element);
  if (options.length > 0) {
    match.availableOptions = options;
  }

  return match;
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

    if (
      input.getAttribute('role') === 'combobox'
      || input.getAttribute('aria-autocomplete') === 'list'
      || input.closest('[role="combobox"]')
    ) {
      matches.push(buildMatch(input, 'combobox', vaultData, learnedMappings));
      continue;
    }

    const type = input.type;
    const fieldType: FormFieldMatch['fieldType'] =
      type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'input';

    matches.push(buildMatch(input, fieldType, vaultData, learnedMappings));
  }
  return matches;
}

function scanComboboxes(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[],
): FormFieldMatch[] {
  const matches: FormFieldMatch[] = [];
  const seen = new WeakSet<HTMLElement>();

  const comboboxes = document.querySelectorAll<HTMLElement>(
    '[role="combobox"]:not(input), .select2-container, .ant-select, .MuiSelect-root, [aria-haspopup="listbox"]:not(select)',
  );

  for (const element of comboboxes) {
    if (!isVisible(element) || seen.has(element)) continue;
    if (element.querySelector('select')) continue;
    seen.add(element);
    matches.push(buildMatch(element, 'combobox', vaultData, learnedMappings));
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
    matches.push(buildMatch(textarea, 'textarea', vaultData, learnedMappings));
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
    if (select.offsetParent === null && select.getBoundingClientRect().width === 0) {
      const label = getFieldLabel(select);
      if (!label && !select.name) continue;
    }
    matches.push(buildMatch(select, 'select', vaultData, learnedMappings));
  }
  return matches;
}

export function scanFormFields(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[] = [],
): FormFieldMatch[] {
  const matches = [
    ...scanInputs(vaultData, learnedMappings),
    ...scanComboboxes(vaultData, learnedMappings),
    ...scanTextareas(vaultData, learnedMappings),
    ...scanSelects(vaultData, learnedMappings),
  ];

  const seen = new WeakSet<HTMLElement>();
  return matches.filter((match) => {
    if (seen.has(match.element)) return false;
    seen.add(match.element);
    return true;
  });
}

export function toPageFormFieldDescriptors(
  matches: FormFieldMatch[],
): import('@/types').PageFormFieldDescriptor[] {
  return matches.map((match) => ({
    label: match.label,
    name: match.name,
    placeholder: match.placeholder,
    isLongAnswer: match.isLongAnswer,
  }));
}

export function toFormTargetFields(
  matches: FormFieldMatch[],
  learnedMappings: LearnedMapping[] = [],
): FormTargetField[] {
  const targets: FormTargetField[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (match.isLongAnswer) continue;

    const label = getFormFieldDisplayLabel(match.label, match.name, match.placeholder);
    if (!label) continue;

    let vaultKey = match.vaultKey;
    if (!vaultKey) {
      vaultKey = matchFieldToVaultKey(
        match.label,
        match.name,
        match.placeholder,
        learnedMappings,
      ).vaultKey;
    }
    if (!vaultKey || seen.has(vaultKey)) continue;

    seen.add(vaultKey);
    targets.push({
      vaultKey,
      label,
      name: match.name,
      placeholder: match.placeholder,
      fieldType: match.fieldType,
      options: match.availableOptions,
    });
  }

  return targets;
}

function toSelectOptions(match: FormFieldMatch): SelectOption[] {
  if (match.element instanceof HTMLSelectElement) {
    return getNativeSelectOptions(match.element);
  }
  const associated = match.element.querySelector('select');
  if (associated) {
    return getNativeSelectOptions(associated);
  }
  return (match.availableOptions ?? []).map((text) => ({ value: text, text }));
}

const DROPDOWN_FILL_ORDER: Record<string, number> = {
  country: 10,
  state: 20,
  city: 30,
  district: 35,
  locality: 40,
  pincode: 50,
};

function dropdownSortKey(match: FormFieldMatch): number {
  if (!match.vaultKey) return 100;
  if (match.vaultKey in DROPDOWN_FILL_ORDER) {
    return DROPDOWN_FILL_ORDER[match.vaultKey];
  }
  if (match.fieldType === 'select' || match.fieldType === 'combobox') {
    return 60;
  }
  return 80;
}

async function fillFieldAsync(match: FormFieldMatch, value: string): Promise<boolean> {
  const { element, fieldType } = match;

  try {
    if (fieldType === 'select' || fieldType === 'combobox') {
      const target = findAssociatedSelect(element) ?? element;
      return fillDropdownElementAsync(target, value, toSelectOptions(match));
    }

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

export function fillField(match: FormFieldMatch, value: string): boolean {
  void fillFieldAsync(match, value);
  return true;
}

export function analyzeForm(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[] = [],
): FillReport {
  const matches = scanFormFields(vaultData, learnedMappings);
  let filledCount = 0;
  let reviewCount = 0;
  let unknownCount = 0;

  clearHighlights();

  for (const match of matches) {
    if (match.isLongAnswer) {
      reviewCount++;
      highlightField(match.element, 'review');
      continue;
    }

    if (match.suggestedValue && match.confidence >= 0.5) {
      if (match.needsReview) {
        reviewCount++;
        highlightField(match.element, 'review');
      } else {
        filledCount++;
        highlightField(match.element, 'filled');
      }
    } else if (match.suggestedValue) {
      filledCount++;
      highlightField(match.element, 'filled');
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

export async function fillFormAsync(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[] = [],
): Promise<FillReport> {
  const matches = scanFormFields(vaultData, learnedMappings);
  let filledCount = 0;
  let reviewCount = 0;
  let unknownCount = 0;

  const ordered = [...matches].sort((a, b) => dropdownSortKey(a) - dropdownSortKey(b));

  for (const match of ordered) {
    if (match.isLongAnswer) {
      reviewCount++;
      continue;
    }

    if (!match.suggestedValue) {
      unknownCount++;
      highlightField(match.element, 'unknown');
      continue;
    }

    if (match.needsReview && match.confidence >= 0.5) {
      reviewCount++;
    }

    const isDropdown = match.fieldType === 'select' || match.fieldType === 'combobox';
    if (isDropdown) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    const filled = await fillFieldAsync(match, match.suggestedValue);
    if (filled) {
      filledCount++;
      highlightField(match.element, match.needsReview ? 'review' : 'filled');
    } else if (match.fieldType === 'select' && match.element instanceof HTMLSelectElement) {
      const retry = fillNativeSelect(match.element, match.suggestedValue);
      if (retry) {
        filledCount++;
        highlightField(match.element, 'filled');
      } else {
        unknownCount++;
        highlightField(match.element, 'unknown');
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

export function fillForm(
  vaultData: Record<string, string>,
  learnedMappings: LearnedMapping[] = [],
): FillReport {
  void fillFormAsync(vaultData, learnedMappings);
  return analyzeForm(vaultData, learnedMappings);
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
