import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  preview: { port: 47316 },
  // Building a big track takes a few seconds on a slow or battery-saving machine.
  test: { testTimeout: 20_000 },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), room: resolve(import.meta.dirname, 'room.html'), editor: resolve(import.meta.dirname, 'editor.html') } },
  },
});
