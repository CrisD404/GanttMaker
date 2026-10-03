/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { llmDocsPlugin } from './tools/llm-docs.ts';
import { pwaPlugin } from './tools/pwa.ts';

// Sitio 100% estático: no hay backend. `base: './'` permite publicarlo en cualquier subcarpeta.
export default defineConfig({
  base: './',
  plugins: [preact(), llmDocsPlugin(), pwaPlugin()],
  server: { port: 5173 },
  build: {
    // Un solo chunk: permite generar la versión offline en un único archivo HTML
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
