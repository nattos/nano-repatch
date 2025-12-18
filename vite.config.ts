/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { run } from 'vite-plugin-run';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  root: 'src',
  publicDir: '../assets',
  server: {
  },
  plugins: [
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.{idea,git,cache,output,temp}/**', '**/e2e/**', 'test/**'],
  },
});
