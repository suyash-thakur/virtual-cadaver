import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Set BASE_PATH=/repo-name/ when hosting under a subpath (GitHub Pages project site).
  base: process.env.BASE_PATH || '/',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1200, rollupOptions: { input: { main: 'index.html', teacher: 'teacher.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
