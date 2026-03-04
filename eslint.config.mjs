// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default tseslint.config(
  // Global ignores
  { ignores: ['.github/**', 'lib/**', 'node_modules/**', 'coverage/**', 'src/coverage/**', '**/*.js', '**/*.mjs', 'tsup.config.ts', 'src/Tests/**', 'src/**/*.test.ts', 'src/**/*.spec.ts'] },

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
      'import-x': importPlugin,
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

      // ── Import organization & Limits ─────────────────────────────────────
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/no-duplicates': 'error',
      // LIMIT: Max 15 unique module imports per file to prevent "God Files"
      'import-x/max-dependencies': ['error', { max: 15, ignoreTypeImports: true }],

      // Quotes
      quotes: ['error', 'single', { avoidEscape: true }],

      // ── Visibility & Return Types ────────────────────────────────────────
      // Force explicit 'public', 'private', or 'protected'
      '@typescript-eslint/explicit-member-accessibility': ['error', {
        accessibility: 'explicit',
        overrides: { constructors: 'no-public' },
      }],

      // Force explicit return types (including : void)
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: false,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
        allowDirectConstAssertionInArrowFunctions: true,
      }],

      // Relaxed rules (matching previous .eslintrc.js)
      'import-x/prefer-default-export': 'error',
      'no-nested-ternary': 'error',
      'class-methods-use-this': 'error',
      'arrow-body-style': 'off',
      'no-shadow': 'off',
      'no-await-in-loop': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='logger'] Property[key.name=/password|token|secret|auth|creditCard/i]",
          message: 'SECURITY: Do not log sensitive data keys.',
        },
        {
          selector: "CallExpression[callee.object.name='logger'][callee.property.name=/debug|info|warn|error/] Identifier[name=/^credentials$|^password$|^token$|^secret$|^otp$/]",
          message: 'SECURITY: Do not pass credential variables to logger. Pino redaction handles sensitive paths.',
        },
         'error',
        {
          selector: ":matches(TSInterfaceDeclaration, TSTypeAliasDeclaration, ClassDeclaration) ~ :matches(TSInterfaceDeclaration, TSTypeAliasDeclaration, ClassDeclaration)",
          message: "Each file should only export one primary structure (Interface, Type, or Class).",
       },
        'ForInStatement',
        'LabeledStatement',
        'WithStatement',
      ],

      // ── Strict type safety ───────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error', 
      '@typescript-eslint/ban-ts-comment': 'error', 

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],

      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',

      '@typescript-eslint/restrict-template-expressions': ['error', { allowNever: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

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
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          selector: 'variable',
          modifiers: ['const', 'global'],
          format: ['UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'should', 'can', 'did', 'will'],
        },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
      ],

      // ── Clean Code limits ────────────────────────────────────────────────
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      'complexity': ['error', { max: 10 }],
      'max-classes-per-file': ['error', 1],
      'unused-imports/no-unused-imports': 'error',
      'no-unreachable': 'error',
      'no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-private-class-members': 'error',
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'no-unused-vars':  'error',
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

  // Test / spec / mock / config files — Exemptions
  {
   files: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/Tests/**/*.ts',
      '**/mocks/**/*.ts',
      'eslint.config.mjs',
    ],
    // This overrides the inclusion above
    ignores: ['src/Tests/**/*.ts', 'src/**/*.test.ts', '**/mocks/**/*.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': 'error',
      'import-x/max-dependencies': 'error', // Tests often need many imports
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      'no-console': 'off',
      'no-warning-comments': 'error',
      'max-lines': 'error',
      'max-lines-per-function': 'error',
      'max-len': 'error',
      'max-classes-per-file': 'error',
      'check-file/filename-naming-convention': 'error',
      'check-file/folder-naming-convention': 'error',
      '@typescript-eslint/naming-convention': 'error',
      '@typescript-eslint/member-ordering': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-member-accessibility': 'error', 
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-unused-vars': 'error',
      'class-methods-use-this': 'error',
      'no-await-in-loop': 'error',
      'import-x/prefer-default-export': 'error',
    },
  },

  // Lowercase entry-point & reserved filenames — disable naming check
  {
    files: [
      'src/index.ts',
      'src/scheduler.ts',
      'src/**/index.ts',
      'src/Utils/currency.ts',
      'src/Utils/date.ts',
    ],
    rules: { 'check-file/filename-naming-convention': 'error' },
  },
);