import { createRoot } from 'react-dom/client';
import { FloatingAssistant } from './FloatingAssistant';
import {
  fillForm,
  clearHighlights,
  detectPortalContext,
} from '@/lib/autofill/form-scanner';
import { getLearnedMappingsForPage } from '@/lib/learning/field-learning';
import type { ExtensionMessage, FillReport } from '@/types';
import './content-script.css';

const ASSISTANT_HOST_ID = 'formvault-assistant-host';

function injectFloatingAssistant(): void {
  if (document.getElementById(ASSISTANT_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = ASSISTANT_HOST_ID;
  host.style.all = 'initial';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.appendChild(container);

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('src/content/content-script.css');
  shadow.appendChild(styleLink);

  const root = createRoot(container);
  root.render(
    <FloatingAssistant
      onFillForm={handleFillForm}
      onClearHighlights={clearHighlights}
      portalContext={detectPortalContext()}
    />,
  );
}

async function handleFillForm(): Promise<FillReport | null> {
  const response = await chrome.runtime.sendMessage({
    type: 'FILL_FORM',
  } as ExtensionMessage);

  if (response?.error || !response?.vaultData) return null;

  const mappings = await getLearnedMappingsForPage(window.location.href);
  return fillForm(response.vaultData, mappings);
}

// Text expansion listener
document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return;
  }

  const value = target.value;
  const shortcutMatch = value.match(/@(\w+)$/);
  if (!shortcutMatch) return;

  void expandShortcut(shortcutMatch[1], target);
});

async function expandShortcut(
  trigger: string,
  element: HTMLInputElement | HTMLTextAreaElement,
): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: 'FILL_FORM',
  } as ExtensionMessage);

  if (!response?.vaultData) return;

  const vaultData = response.vaultData as Record<string, string>;
  const expansion = vaultData[trigger];

  if (expansion) {
    const current = element.value;
    element.value = current.replace(new RegExp(`@${trigger}$`), expansion);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Message handler from popup/background
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'FILL_FORM') {
      void handleFillForm().then(sendResponse);
      return true;
    }
    if (message.type === 'SCAN_FORM') {
      void handleFillForm().then((report) => {
        sendResponse(report);
      });
      return true;
    }
    return false;
  },
);

// Initialize
function init(): void {
  chrome.storage.local.get('formvault_settings', (result) => {
    const settings = result.formvault_settings as { enableFloatingAssistant?: boolean } | undefined;
    if (settings?.enableFloatingAssistant !== false) {
      injectFloatingAssistant();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
