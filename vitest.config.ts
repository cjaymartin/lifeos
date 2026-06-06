import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Node by default; client-module tests opt into jsdom per-file with
    // `// @vitest-environment jsdom`.
    environment: 'node',
  },
});
