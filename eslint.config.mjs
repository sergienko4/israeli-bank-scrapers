import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  { ignores: ['lib/**', 'node_modules/**', 'coverage/**', 'src/coverage/**', '**/*.js', '**/*.mjs'] },

  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Prettier (disables formatting rules)
  prettier,

  // TypeScript source files
  {
    files: ['src/**/*.ts'],
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.es2021,
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Quotes
      quotes: ['error', 'single', { avoidEscape: true }],

      // Relaxed rules (matching previous .eslintrc.js)
      'import/prefer-default-export': 'off',
      'no-nested-ternary': 'off',
      'class-methods-use-this': 'off',
      'arrow-body-style': 'off',
      'no-shadow': 'off',
      'no-await-in-loop': 'off',
      'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement', 'WithStatement'],

      // ── Strict type safety ───────────────────────────────────────────────
      // Zero-Compromise: no 'any', no unsafe operations, explicit return types.
      // Use typed interfaces or generics instead. Fix by adding proper types.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,      // allow arrow functions in JSX/callbacks
        allowHigherOrderFunctions: true,
        allowTypedFunctionExpressions: true,
      }],
      '@typescript-eslint/no-non-null-assertion': 'off', // ← allow ! for known-non-null
      '@typescript-eslint/ban-ts-comment': 'off',         // ← allow @ts-ignore with justification

      // Allow underscore-prefixed unused vars (common destructuring pattern)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],

      // New in typescript-eslint v8 — disable to match previous behavior
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',

      // TypeScript enforced rules
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNever: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

      // Import rules
      'import/no-unresolved': 'off', // TypeScript handles this
      'import/named': 'off', // TypeScript handles this

      // ── Clean Code limits ────────────────────────────────────────────────
      // All 'error' — lint-staged only lints changed files, so violations in
      // untouched legacy code don't block commits. Any file you touch must comply.
      // Aim: 10 lines ideal (CLAUDE.md). 20 lines = ESLint hard limit.
      // Fix strategies → see CLEAN_CODE.md
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],

      // Max 3 params: beyond that use an options object / interface.
      '@typescript-eslint/max-params': ['error', { max: 3 }],

      // Cyclomatic complexity cap — prevents deeply nested conditionals.
      'complexity': ['error', { max: 10 }],

      // One class per file — keeps modules focused.
      'max-classes-per-file': ['error', 1],

      // Unused imports — auto-fixable via lint:fix.
      'unused-imports/no-unused-imports': 'error',

      // Dead code guards
      'no-unreachable': 'error',
      'no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-private-class-members': 'error',

      // File length — 300 lines max (source files only; tests/mocks exempt below).
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },

  // Test / spec / mock files — exempt from length limits.
  // Tests have long 'it()' blocks by design; mocks contain fixture data.
  {
    files: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/tests/**/*.ts', '**/mocks/**/*.ts'],
    rules: {
      'import/no-extraneous-dependencies': 'off',
      'no-console': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-classes-per-file': 'off',
    },
  },
);
