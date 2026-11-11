// @ts-check
/**
 * Global ignores and the base recommended/type-checked rule sets.
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import regexpPlugin from 'eslint-plugin-regexp';
import prettier from 'eslint-config-prettier';

export const BASE_BLOCKS = [
  // 1. GLOBAL IGNORES
  {
    ignores: [
      '.github/**',
      'lib/**',
      'node_modules/**',
      'coverage/**',
      'src/coverage/**',
      'tsup.config.ts',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/EslintCanaries/**',
      // Local-only real-credential harnesses (mirror of .gitignore pattern):
      // never linted because they are never committed.
      'src/Tests/**/*.local.test.ts',
    ],
  },

  // 2. BASE CONFIGS
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  regexpPlugin.configs['flat/recommended'],
  prettier,
];
