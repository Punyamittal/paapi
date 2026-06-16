function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeOptionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeOptionText(text)
      .split(' ')
      .filter((token) => token.length > 1),
  );
}

const VALUE_ALIASES: Record<string, string[]> = {
  delhi: ['new delhi', 'delhi ncr', 'nct of delhi'],
  bengaluru: ['bangalore', 'bengaluru urban'],
  bangalore: ['bengaluru', 'bangalore urban'],
  mumbai: ['bombay', 'mumbai city'],
  kolkata: ['calcutta'],
  chennai: ['madras'],
  gurugram: ['gurgaon'],
  gurgaon: ['gurugram'],
};

function valueVariants(value: string): string[] {
  const base = value.trim();
  const normalized = normalizeOptionText(base);
  const variants = new Set<string>([base, normalized]);
  for (const alias of VALUE_ALIASES[normalized] ?? []) {
    variants.add(alias);
  }
  return [...variants];
}

export function scoreOptionMatch(
  value: string,
  optionText: string,
  optionValue = '',
): number {
  let best = 0;
  for (const variant of valueVariants(value)) {
    best = Math.max(best, scoreSingleMatch(variant, optionText, optionValue));
  }
  return best;
}

function scoreSingleMatch(
  value: string,
  optionText: string,
  optionValue = '',
): number {
  const normalizedValue = normalizeOptionText(value);
  if (!normalizedValue) return 0;

  const normalizedText = normalizeOptionText(optionText);
  const normalizedVal = normalizeOptionText(optionValue);

  if (normalizedValue === normalizedText || normalizedValue === normalizedVal) {
    return 1;
  }

  if (
    normalizedText.includes(normalizedValue)
    || normalizedValue.includes(normalizedText)
    || normalizedVal.includes(normalizedValue)
    || normalizedValue.includes(normalizedVal)
  ) {
    return 0.92;
  }

  const valueTokens = [...tokenSet(normalizedValue)];
  const textTokens = tokenSet(`${normalizedText} ${normalizedVal}`);
  if (valueTokens.length === 0) return 0;

  const overlap = valueTokens.filter((token) => textTokens.has(token)).length;
  const ratio = overlap / valueTokens.length;
  if (ratio >= 0.5) return 0.72 + ratio * 0.2;

  if (normalizedValue.length >= 3 && normalizedText.startsWith(normalizedValue.slice(0, 3))) {
    return 0.62;
  }

  return 0;
}

export interface SelectOption {
  value: string;
  text: string;
}

export function pickBestOption(
  value: string,
  options: SelectOption[],
): SelectOption | null {
  let best: SelectOption | null = null;
  let bestScore = 0;

  for (const option of options) {
    if (!option.text && !option.value) continue;
    const score = scoreOptionMatch(value, option.text, option.value);
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }

  return bestScore >= 0.55 ? best : null;
}

export function getNativeSelectOptions(select: HTMLSelectElement): SelectOption[] {
  return [...select.options]
    .filter((option) => {
      const text = option.text.trim();
      return text && !/^(select|choose|--|please select)/i.test(text);
    })
    .map((option) => ({
      value: option.value,
      text: option.text.trim(),
    }));
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }
}

function dispatchReactEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) < 0.05) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

export function findAssociatedSelect(element: HTMLElement): HTMLSelectElement | null {
  if (element instanceof HTMLSelectElement) return element;

  const inTree = element.querySelector('select');
  if (inTree) return inTree;

  const container = element.closest(
    'div, fieldset, label, .form-group, .field, .input-group, [class*="form"]',
  );
  if (container) {
    const nested = container.querySelector('select');
    if (nested) return nested;
  }

  let sibling = element.previousElementSibling;
  for (let i = 0; i < 3 && sibling; i += 1) {
    if (sibling instanceof HTMLSelectElement) return sibling;
    const inner = sibling.querySelector?.('select');
    if (inner) return inner;
    sibling = sibling.previousElementSibling;
  }

  sibling = element.nextElementSibling;
  for (let i = 0; i < 3 && sibling; i += 1) {
    if (sibling instanceof HTMLSelectElement) return sibling;
    const inner = sibling.querySelector?.('select');
    if (inner) return inner;
    sibling = sibling.nextElementSibling;
  }

  return null;
}

function findDropdownTriggers(element: HTMLElement): HTMLElement[] {
  const triggers: HTMLElement[] = [];
  const push = (el: HTMLElement | null) => {
    if (el && isElementVisible(el) && !triggers.includes(el)) {
      triggers.push(el);
    }
  };

  push(element);
  push(element.querySelector('[role="combobox"]') as HTMLElement | null);
  push(element.querySelector('[role="button"]') as HTMLElement | null);
  push(element.querySelector('[aria-haspopup="listbox"]') as HTMLElement | null);
  push(element.querySelector('.MuiSelect-select') as HTMLElement | null);
  push(element.querySelector('.ant-select-selector') as HTMLElement | null);
  push(element.querySelector('.select2-selection') as HTMLElement | null);
  push(element.querySelector('button') as HTMLElement | null);

  const select = findAssociatedSelect(element);
  if (select) push(select);

  return triggers;
}

function resolveComboboxInput(element: HTMLElement): HTMLInputElement | null {
  if (element instanceof HTMLInputElement) return element;
  return element.querySelector(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
  ) as HTMLInputElement | null;
}

function collectMenuOptions(): HTMLElement[] {
  const selectors = [
    '[role="listbox"] [role="option"]',
    '[role="listbox"] li',
    '.ant-select-item-option',
    '.ant-select-item',
    '.MuiMenuItem-root',
    '.MuiAutocomplete-option',
    '.select2-results__option',
    '.dropdown-menu .dropdown-item',
    '.dropdown-menu li',
  ];

  const found: HTMLElement[] = [];
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const el = node as HTMLElement;
      if (!isElementVisible(el)) continue;
      if (found.includes(el)) continue;
      found.push(el);
    }
  }
  return found;
}

function clickBestMenuOption(value: string): boolean {
  let bestEl: HTMLElement | null = null;
  let bestScore = 0;

  for (const option of collectMenuOptions()) {
    const text = option.textContent?.trim() ?? '';
    const score = scoreOptionMatch(value, text);
    if (score > bestScore) {
      bestScore = score;
      bestEl = option;
    }
  }

  if (!bestEl || bestScore < 0.55) return false;

  bestEl.scrollIntoView({ block: 'nearest' });
  bestEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  bestEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  bestEl.click();
  return true;
}

async function activateDropdown(element: HTMLElement): Promise<void> {
  const triggers = findDropdownTriggers(element);
  for (const trigger of triggers) {
    trigger.focus();
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    trigger.click();
    await sleep(80);
  }
}

async function typeIntoSearchableInput(input: HTMLInputElement, value: string): Promise<void> {
  input.focus();
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  input.click();

  setNativeValue(input, '');
  dispatchReactEvents(input);
  await sleep(50);

  setNativeValue(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  await sleep(120);

  if (!clickBestMenuOption(value)) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await sleep(60);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(60);
    clickBestMenuOption(value);
  }
}

export function fillNativeSelect(select: HTMLSelectElement, value: string): boolean {
  const match = pickBestOption(value, getNativeSelectOptions(select));
  if (!match) return false;

  const index = [...select.options].findIndex(
    (option) => option.value === match.value || option.text.trim() === match.text,
  );

  if (index >= 0) {
    select.selectedIndex = index;
  }

  setNativeValue(select, match.value);
  dispatchReactEvents(select);
  return select.value === match.value || select.selectedIndex === index;
}

async function fillNativeSelectAsync(select: HTMLSelectElement, value: string): Promise<boolean> {
  select.focus();
  select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  select.click();
  await sleep(150);

  const freshOptions = getNativeSelectOptions(select);
  const match = pickBestOption(value, freshOptions.length > 0 ? freshOptions : getNativeSelectOptions(select));
  if (!match) return false;

  const index = [...select.options].findIndex(
    (option) =>
      option.value === match.value
      || normalizeOptionText(option.text) === normalizeOptionText(match.text),
  );

  if (index >= 0) {
    select.selectedIndex = index;
  }
  setNativeValue(select, match.value);
  dispatchReactEvents(select);

  if (select.value === match.value || select.selectedIndex === index) {
    return true;
  }

  await sleep(200);
  const retryOptions = getNativeSelectOptions(select);
  const retryMatch = pickBestOption(value, retryOptions);
  if (!retryMatch) return false;

  const retryIndex = [...select.options].findIndex((option) => option.value === retryMatch.value);
  if (retryIndex >= 0) select.selectedIndex = retryIndex;
  setNativeValue(select, retryMatch.value);
  dispatchReactEvents(select);
  return select.value === retryMatch.value;
}

export async function fillDropdownElementAsync(
  element: HTMLElement,
  value: string,
  knownOptions: SelectOption[] = [],
): Promise<boolean> {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const match = knownOptions.length > 0 ? pickBestOption(trimmed, knownOptions) : null;
  const targetValue = match?.text ?? trimmed;

  const nativeSelect = findAssociatedSelect(element);
  if (nativeSelect) {
    if (await fillNativeSelectAsync(nativeSelect, targetValue)) {
      return true;
    }
  }

  if (element instanceof HTMLSelectElement) {
    if (await fillNativeSelectAsync(element, targetValue)) {
      return true;
    }
  }

  const input = resolveComboboxInput(element);
  if (input) {
    await typeIntoSearchableInput(input, targetValue);
    await sleep(100);
    if (clickBestMenuOption(targetValue)) return true;
  }

  await activateDropdown(element);
  await sleep(180);

  if (clickBestMenuOption(targetValue)) {
    return true;
  }

  if (input) {
    await typeIntoSearchableInput(input, targetValue);
    await sleep(120);
    if (clickBestMenuOption(targetValue)) return true;
  }

  if (nativeSelect) {
    return fillNativeSelect(nativeSelect, targetValue);
  }

  return false;
}

/** Sync wrapper — prefer fillDropdownElementAsync for reliable results. */
export function fillDropdownElement(
  element: HTMLElement,
  value: string,
  knownOptions: SelectOption[] = [],
): boolean {
  void fillDropdownElementAsync(element, value, knownOptions);
  return true;
}
