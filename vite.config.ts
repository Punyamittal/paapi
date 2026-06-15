import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import manifest from './manifest.dev.json';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), crx({ manifest })],
  build: {
    outDir: 'formvault-extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: resolve('src/offscreen/offscreen.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('lucide-react')) {
            return 'lucide';
          }
          if (id.includes('lib/ai/ollama-client')) {
            return 'ollama-client';
          }
          if (id.includes('lib/documents/ocr-client')) {
            return 'ocr-client';
          }
          if (id.includes('lib/storage/chrome-storage')) {
            return 'chrome-settings';
          }
          if (id.includes('lib/documents/ollama-paste-extract')) {
            return 'ollama-paste-extract';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve('src'),
    },
  },
});
