/**
 * A relative base keeps asset URLs valid under the GitHub Pages project path
 * whatever the repository name's casing. WebLLM is excluded from pre-bundling
 * because it only loads when the learner picks the in-browser model.
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: { exclude: ['@mlc-ai/web-llm'] },
  // The large chunk is WebLLM, fetched only when the learner loads the browser model.
  build: { chunkSizeWarningLimit: 7000 },
  test: {
    include: ['src/**/*.test.ts', 'worker/test/**/*.test.ts'],
  },
});
