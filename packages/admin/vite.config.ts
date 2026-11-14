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
  // CSS-referenced assets (the kit's bundled fonts) load relative to the stylesheet: the provider
  // rewrites the base placeholder in served text files, but a relative URL keeps the fonts working
  // even where a proxy or CDN serves the CSS untouched.
  experimental: {
    renderBuiltUrl: (_file, { hostType }) => (hostType === 'css' ? { relative: true } : undefined),
  },
  build: { outDir: 'dist/spa', emptyOutDir: true, sourcemap: true },
});
