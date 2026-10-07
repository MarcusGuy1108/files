import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The game's version comes from package.json ("0.5.0" shows as "v0.5").
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version.split('.').slice(0, 2).join('.')) },
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  // three.js alone is ~550 kB minified (~140 kB gzipped); that's expected.
  build: { chunkSizeWarningLimit: 800 },
});
