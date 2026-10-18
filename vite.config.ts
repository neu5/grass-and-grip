import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  preview: { port: 47316 },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), room: resolve(import.meta.dirname, 'room.html') } },
  },
});
