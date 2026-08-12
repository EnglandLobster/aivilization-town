import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '.qoder/**', '.zcode/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'apps/web/tools/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        project: false,
      },
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['apps/web/test/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
  },
  {
    files: ['apps/web/public/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        project: false,
      },
      globals: {
        Array: 'readonly',
        Date: 'readonly',
        Error: 'readonly',
        EventSource: 'readonly',
        FormData: 'readonly',
        Image: 'readonly',
        Intl: 'readonly',
        JSON: 'readonly',
        Math: 'readonly',
        Number: 'readonly',
        Object: 'readonly',
        Promise: 'readonly',
        ResizeObserver: 'readonly',
        String: 'readonly',
        cancelAnimationFrame: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        requestAnimationFrame: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
      },
    },
  },
);
