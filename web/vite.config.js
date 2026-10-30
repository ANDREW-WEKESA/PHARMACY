import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the frontend runs on :5173 and forwards /api to the Worker on :8787
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
