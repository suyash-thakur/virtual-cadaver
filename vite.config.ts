import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1200, rollupOptions: { input: { main: 'index.html', teacher: 'teacher.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
