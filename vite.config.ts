import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0', port: 47315, strictPort: true },
  preview: { port: 47316 },
});
