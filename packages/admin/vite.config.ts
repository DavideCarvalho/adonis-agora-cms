import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Builds the SPA into `dist/spa`. The `base` is a placeholder the provider rewrites at serve
 * time, so the same bundle mounts under any `admin.path` without a rebuild.
 */
export default defineConfig({
  base: '/__CMS_ADMIN__/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/spa', emptyOutDir: true, sourcemap: true },
});
