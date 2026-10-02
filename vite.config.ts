import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  // three.js alone is ~550 kB minified (~140 kB gzipped); that's expected.
  build: { chunkSizeWarningLimit: 800 },
});
