// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default tseslint.config(
  // Global ignores
  { ignores: ['lib/**', 'node_modules/**', 'coverage/**', 'src/coverage/**', '**/*.js', '**/*.mjs', 'tsup.config.ts'] },

  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Prettier (disables formatting rules)
  prettier,

  // TypeScript source files
  {
    files: ['src/**/*.ts'],
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
      'check-file': checkFile,
      'simple-import-sort': simpleImportSort,
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
      // ── Logging & Security ───────────────────────────────────────────────
      'no-console': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme'], location: 'anywhere' }],

      // ── Import organization ──────────────────────────────────────────────
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import/no-duplicates': 'error',

      // Quotes
      quotes: ['error', 'single', { avoidEscape: true }],

      // Relaxed rules (matching previous .eslintrc.js)
      'import/prefer-default-export': 'off',
      'no-nested-ternary': 'off',
      'class-methods-use-this': 'off',
      'arrow-body-style': 'off',
      'no-shadow': 'off',
      'no-await-in-loop': 'off',
      'no-restricted-syntax': [
        'error',
        // Security: block logging sensitive fields via logger calls
        {
          selector: "CallExpression[callee.object.name='logger'] Property[key.name=/password|token|secret|auth|creditCard/i]",
          message: 'SECURITY: Do not log sensitive data keys.',
        },
        // Security: block passing credential variables to logger.debug()
        {
          selector:
            "CallExpression[callee.object.name='logger'][callee.property.name=/debug|info|warn|error/] Identifier[name=/^credentials$|^password$|^token$|^secret$|^otp$/]",
          message: 'SECURITY: Do not pass credential variables to logger. Pino redaction handles sensitive paths.',
        },
        'ForInStatement',
        'LabeledStatement',
        'WithStatement',
      ],

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

      // ── Structural & naming ──────────────────────────────────────────────
      'check-file/filename-naming-convention': [
        'error',
        { 'src/**/*.{ts,tsx}': 'PASCAL_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': ['error', { 'src/**/': 'PASCAL_CASE' }],

      '@typescript-eslint/member-ordering': ['error', {
        default: [
          'public-static-field',
          'protected-static-field',
          'private-static-field',
          'public-instance-field',
          'protected-instance-field',
          'private-instance-field',
          'constructor',
          'public-instance-method',
          'protected-instance-method',
          'private-instance-method',
        ],
      }],

      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: { regex: '^I[A-Z]', match: false },
        },
        { selector: ['variable', 'function', 'method'], format: ['camelCase'] },
        // Allow leading underscore on unused parameters (e.g. _credentials, _)
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          selector: 'variable',
          modifiers: ['const', 'global'],
          format: ['UPPER_CASE'],
          // Allow _PREFIXED_UPPER_CASE for throw-away destructured vars
          leadingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          types: ['boolean'],
          // After prefix strip the remainder must be PascalCase: isOutbound → Outbound ✓
          format: ['PascalCase'],
          prefix: ['is', 'has', 'should', 'can', 'did', 'will'],
        },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
      ],

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

      // Explicit no-unused-vars off (handled by @typescript-eslint/no-unused-vars above).
      'no-unused-vars': 'off',

      // Max line length — matches Prettier printWidth.
      // Strings/templates/regex/comments are excluded: they can't always be wrapped
      // without degrading readability (URLs, error messages, regex patterns).
      'max-len': [
        'error',
        {
          code: 100,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
          ignoreComments: true,
        },
      ],
    },
  },

  // Test / spec / mock / config files — exempt from length, naming, and type-safety rules.
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/Tests/**/*.ts',
      '**/mocks/**/*.ts',
      'eslint.config.mjs',
    ],
    rules: {
      'import/no-extraneous-dependencies': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'no-console': 'off',
      'no-warning-comments': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-len': 'off',
      'max-classes-per-file': 'off',
      'check-file/filename-naming-convention': 'off',
      'check-file/folder-naming-convention': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/member-ordering': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Lowercase entry-point & reserved filenames — exempt from PascalCase filename rule.
  {
    files: [
      'src/index.ts',
      'src/scheduler.ts',
      'src/**/index.ts',
      'src/Utils/currency.ts',
      'src/Utils/date.ts',
    ],
    rules: { 'check-file/filename-naming-convention': 'off' },
  },
);
