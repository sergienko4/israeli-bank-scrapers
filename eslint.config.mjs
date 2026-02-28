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

      // TypeScript relaxed rules
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',

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
    },
  },

  // Test file overrides (replaces src/tests/.eslintrc.js)
  {
    files: ['src/**/*.test.ts', 'src/tests/**/*.ts'],
    rules: {
      'import/no-extraneous-dependencies': 'off',
      'no-console': 'off',
    },
  },
);
