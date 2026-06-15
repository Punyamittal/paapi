# FormVault AI

A privacy-first Chrome extension that acts as a personal knowledge vault and intelligent form-filling assistant. All data stays on your device — encrypted, local, and never shared with any server.

## Features

- **Encrypted Personal Vault** — Store reusable personal information (name, phone, email, addresses, IDs, education, skills, etc.) with AES-256 encryption
- **Multiple Profiles** — Switch between Personal, Job Application, Scholarship, and custom profiles instantly
- **Smart Document Repository** — Upload PDFs, DOCX, and images; auto-extract text and personal data
- **Universal Autofill Engine** — Detect and fill form fields on any website with synonym matching and learned mappings
- **One-Click Form Fill** — Floating assistant button with fill report (filled / review / unknown)
- **AI Long Answer Generator** — Generate contextual responses for application questions (local-first, optional API)
- **Saved Answers Library** — Reusable responses for common form questions
- **Smart Text Expansion** — Type `@phone`, `@email`, `@github` to insert stored values
- **Form Learning System** — Learns field mappings from manual entries per domain
- **Local Search Engine** — Semantic search across vault fields, documents, and saved answers
- **Encrypted Backup & Restore** — Export/import your vault as encrypted JSON

## Privacy Guarantees

- No cloud database
- No user accounts
- No analytics or telemetry
- No third-party data sharing
- All processing happens locally on your device

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | React, TypeScript, Tailwind CSS, Manifest V3 |
| Storage | IndexedDB, Chrome Storage API |
| Encryption | Web Crypto API (AES-256-GCM, PBKDF2) |
| PDF Parsing | PDF.js |
| DOCX Parsing | Mammoth.js |
| OCR | Tesseract.js (ready to integrate) |
| AI | Local templates, **Ollama (local models)**, optional cloud API keys |

## Install as a Chrome Extension (Developer Mode)

FormVault AI is loaded as an **unpacked extension** from the `formvault-extension` folder.

**Easiest way (Windows):** double-click `install-chrome-extension.bat`

Or run:

```bash
npm install
npm run chrome
```

This builds the extension and opens the correct folder in File Explorer.

### Manual install

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select **`formvault-extension`** (NOT the `paapi` folder):

   `c:\Users\punya mittal\paapi\formvault-extension`

### After code changes

1. Run `npm run build`
2. Click **reload** on the FormVault AI card in `chrome://extensions`

### Troubleshooting

| Problem | Fix |
|---------|-----|
| "Manifest file is missing or unreadable" | You selected **`paapi`** by mistake — select **`formvault-extension`** instead |
| Extension doesn't update | Click reload on `chrome://extensions` after rebuilding |
| Popup is blank | Rebuild with `npm run build` and reload the extension |

### Using Ollama (local AI models)

FormVault AI can use **locally downloaded Ollama models** for generating long-form answers. No cloud API is required.

1. Install [Ollama](https://ollama.com) and start it
2. Download a model: `ollama pull llama3.2`
3. Rebuild and reload the extension
4. Open FormVault AI → **Settings** → **AI Provider** → **Ollama**
5. Refresh models and select one

### Build for Production

```bash
npm run build
```

The loadable Chrome extension is in **`formvault-extension`**.

## Project Structure

```
src/
├── background/          # Service worker (session, messaging)
├── content/           # Content script + floating assistant
├── popup/             # Extension popup dashboard
├── lib/
│   ├── ai/            # Answer generation engine
│   ├── autofill/      # Field matching + form scanner
│   ├── backup/        # Encrypted export/import
│   ├── crypto/        # AES encryption + session management
│   ├── documents/     # PDF/DOCX parsing + extraction
│   ├── learning/      # Form field learning system
│   ├── search/        # Local search engine
│   ├── storage/       # IndexedDB + Chrome storage
│   └── vault/         # Profile + vault management
├── styles/            # Global Tailwind styles
└── types/             # TypeScript type definitions
```

## Usage

1. **First launch** — Set a master password to create your encrypted vault
2. **Fill your vault** — Add personal information in the Vault tab, or upload documents to auto-extract
3. **Create profiles** — Set up different profiles for job apps, scholarships, etc.
4. **Fill forms** — Visit any website with a form, click the floating ⚡ button or use the popup
5. **Text expansion** — Type `@phone` or `@email` in any input field
6. **Backup** — Export an encrypted backup from Settings

## Architecture

```
┌─────────────┐     messages      ┌──────────────────┐
│   Popup UI  │ ◄──────────────► │  Service Worker   │
└─────────────┘                   └────────┬─────────┘
                                           │
┌─────────────┐     messages               │ IndexedDB
│  Content    │ ◄──────────────────────────┤ (encrypted)
│  Script     │                            │
└─────────────┘                   ┌────────┴─────────┐
                                  │  Chrome Storage   │
                                  │  (settings/hash)  │
                                  └──────────────────┘
```

## Roadmap

- [ ] Tesseract.js OCR integration for image documents
- [ ] ONNX Runtime Web / Transformers.js for local LLM inference
- [ ] WebAuthn biometric unlock
- [ ] Sidebar mode on web pages
- [ ] Keyboard shortcuts
- [ ] High contrast accessibility mode

## License

Private — All rights reserved.
# paapi
