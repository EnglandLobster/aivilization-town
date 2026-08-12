import { defineConfig } from 'vitest/config';

// The web package ships plain-JS browser modules from `public/`; unit tests
// for the pure map logic live in `test/` and import those modules directly.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.mjs'],
  },
});
