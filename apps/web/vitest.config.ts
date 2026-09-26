import { defineConfig } from 'vitest/config';

// Test read models, synchronization and framework-independent map logic in Node.
// GPU rendering is verified separately in the browser.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.mjs', 'test/**/*.test.ts'],
  },
});
