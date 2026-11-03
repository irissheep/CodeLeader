import { defineConfig } from 'vite';
export default defineConfig({
  root: 'src/renderer', base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' }
});
