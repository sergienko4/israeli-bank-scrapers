// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import jsdoc from 'eslint-plugin-jsdoc';

export default tseslint.config(
  // 1. GLOBAL IGNORES
  // Removed src/Tests and src/**/*.test.ts from here so the second block can lint them!
  {
    ignores: [
      '.github/**',
      'lib/**',
      'node_modules/**',
      'coverage/**',
      'src/coverage/**',
      '**/*.js',
      '**/*.mjs',
      'tsup.config.ts'
    ]
  },

  // 2. BASE CONFIGS
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,

  // 3. MAIN SOURCE FILES (STRICT)
  {
    files: ['src/**/*.ts'],
    plugins: {
      'import-x': importPlugin,
      'unused-imports': unusedImports,
      'check-file': checkFile,
      'simple-import-sort': simpleImportSort,
      jsdoc,
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
      'no-warning-comments': [
        'error',
        {
          terms: [
            'todo',
            'fixme',
            'istanbul ignore',
            'c8 ignore',
            'v8 ignore',
            '@ts-ignore',
            '@ts-nocheck',
            '@ts-expect-error',
            'eslint-disable'
          ],
          location: 'anywhere'
        }
      ],

      // ── Restricted Syntax (Security, Structure & Zero-Skip Policy) ───────
      'no-restricted-syntax': [
        'error',
        // 1. Coverage Bypasses
        {
          selector: "Program > Block:matches([value*='istanbul ignore'], [value*='c8 ignore'], [value*='v8 ignore'])",
          message: "🚫 COVERAGE SKIP: Write a test instead of ignoring coverage.",
        },

        // 2. Lint Bypasses
        {
          selector: "Line:matches([value*='eslint-disable'])",
          message: "🚫 LINT SKIP: Do not disable ESLint rules. Fix the underlying issue.",
        },

        // 3. Type Bypasses (Non-null assertions)
        {
          selector: "TSNonNullExpression",
          message: "🚫 TYPE SKIP: Do not use non-null assertions (!). Use optional chaining (?.) or a proper null check.",
        },

        // 4. Return Value Integrity (Blocking null & undefined returns)
        {
          // Blocks 'null' or 'undefined' in Type Annotations for functions/methods
          selector: ":matches(TSFunctionType, TSMethodDefinition, FunctionDeclaration) TSTypeAnnotation :matches(Identifier[name='null'], Identifier[name='undefined'], TSNullKeyword, TSUndefinedKeyword)",
          message: "🚫 ARCHITECTURE: Functions cannot return 'null' or 'undefined'. Use a Result Pattern (e.g., IScraperResult).",
        },
        {
          // Blocks 'void' as a return type (Forces every function to return data)
          selector: ":matches(TSFunctionType, TSMethodDefinition, FunctionDeclaration) TSTypeAnnotation TSVoidKeyword",
          message: "🚫 ARCHITECTURE: 'void' is forbidden. Every function must return a meaningful value or status object.",
        },
        {
          // Blocks 'return null;', 'return undefined;', and empty 'return;'
          selector: "ReturnStatement[argument.type='Literal'][argument.value=null], ReturnStatement[argument.type='Identifier'][argument.name='undefined']",
          message: "🚫 LOGIC: Forbidden return value. Functions must explicitly return a valid object or primitive.",
        },

        // 5. Nested Logic & Readability
        {
          // Targets: print(cal(2,3)) - Nested function calls
          selector: "CallExpression > .arguments[type='CallExpression']",
          message: "🚫 FORBIDDEN NESTED CALL: Assign the nested function result to a descriptive variable first for better debugging.",
        },
        {
          selector: "CallExpression[callee.property.name='isStuckOnLoginPage']",
          message: "🚫 FORBIDDEN METHOD: Usage of 'isStuckOnLoginPage' is globally banned.",
        },

        // 6. Security & Logging
        {
          selector: "CallExpression[callee.object.name='logger'] Property[key.name=/password|token|secret|auth|creditCard/i]",
          message: "SECURITY: Do not log sensitive data keys.",
        },
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message: "Do not use 'throw new Error()'. Use a custom Error class (e.g., 'throw new ScraperError()') for PII safety.",
        },
        // ── Type Integrity (Blocking 'unknown' bypasses) ─────────────────────
        {
          // 1. Blocks 'unknown' in function return types
          selector: ":matches(TSFunctionType, TSMethodDefinition, FunctionDeclaration) > TSTypeAnnotation TSUnknownKeyword",
          message: "🚫 ARCHITECTURE: Functions cannot return 'unknown'. Define a specific Interface or Type.",
        },
        {
          // 2. Blocks 'unknown' in function parameters (Arguments)
          selector: "TSParameterProperty TSUnknownKeyword, FunctionDeclaration TSParameterProperty TSUnknownKeyword, TSTypeReference TSUnknownKeyword",
          message: "🚫 ARCHITECTURE: Function parameters cannot be 'unknown'. Use a Discriminated Union or a base Interface.",
        },
        {
          // 3. Blocks 'unknown' in variable type annotations
          selector: "VariableDeclarator > TSTypeAnnotation TSUnknownKeyword",
          message: "🚫 TYPE SKIP: Do not declare variables as 'unknown'. Cast them to a concrete type immediately after receiving external data.",
        },
        // Block: for-in loops (can be used to bypass iterators and cause prototype pollution)
        'ForInStatement',
        'LabeledStatement',
        'WithStatement',
      ],

      // 2. Explicitly ban the TS-specific skip rules
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description', // Only allow if they explain why
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': true,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      // ── Import Organization ──────────────────────────────────────────────
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/max-dependencies': ['error', { max: 15, ignoreTypeImports: true }],

      // ── Style & Visibility ───────────────────────────────────────────────
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

      'import-x/prefer-default-export': 'error',
      'no-nested-ternary': 'error',
      'class-methods-use-this': 'error',
      'arrow-body-style': 'off',
      'no-shadow': 'off',
      'no-await-in-loop': 'error',

      // ── Strict Type Safety ───────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Use TS-specific unused vars rule and turn off the base one
      'no-unused-vars': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],

      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

      // ── Structural & Naming ──────────────────────────────────────────────
      'check-file/filename-naming-convention': ['error', { 'src/**/*.{ts,tsx}': 'PASCAL_CASE' }, { ignoreMiddleExtensions: true }],
      'check-file/folder-naming-convention': ['error', { 'src/**/': 'PASCAL_CASE' }],

      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: { regex: '^I[A-Z]', match: true },
        },
        { selector: ['variable', 'function', 'method'], format: ['camelCase'] },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'should', 'can', 'did', 'will', 'was'],
        },
        {
          selector: 'variable',
          modifiers: ['const', 'global'],
          format: ['UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          selector: 'classProperty',
          modifiers: ['private'],
          format: ['camelCase'],
          leadingUnderscore: 'require',
        },
        { selector: 'variable', modifiers: ['destructured'], format: null },
        { selector: 'typeParameter', format: ['PascalCase'], prefix: ['T'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
      ],

      '@typescript-eslint/member-ordering': ['error', {
        default: [
          'public-static-field', 'protected-static-field', 'private-static-field',
          'public-instance-field', 'protected-instance-field', 'private-instance-field',
          'constructor',
          'public-instance-method', 'protected-instance-method', 'private-instance-method',
        ],
      }],

      // === JSDOC DOCUMENTATION ===
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: false, // Ensures ALL functions (even private) have comments
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: true,
          ArrowFunctionExpression: true,
          FunctionExpression: true,
        },
      }],
      'jsdoc/require-description': ['error', { contexts: ['any'] }],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-param-type': 'off', // TS handles types
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-returns-type': 'off', // TS handles types
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',

      // ── Clean Code Limits ────────────────────────────────────────────────
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      'complexity': ['error', { max: 10 }],
      'max-classes-per-file': ['error', 1],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-len': ['error', { code: 100, ignoreUrls: true, ignoreStrings: true, ignoreComments: true }],
    },
  },

  // 4. TEST / MOCK / CONFIG FILES (RELAXED)
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/Tests/**/*.ts',
      '**/mocks/**/*.ts',
      'eslint.config.mjs',
    ],
    rules: {
      'no-console': 'off', // Allow logging in tests
      'max-lines-per-function': 'off', // Tests are naturally long
      'max-len': 'off', // Test descriptions can be long
      '@typescript-eslint/no-explicit-any': 'error', // More flexible in mocks
      'check-file/filename-naming-convention': 'off', // Allow standard test naming
    },
  },

  // 5. SPECIAL ENTRY POINTS (LOWERCASE EXEMPTIONS)
  {
    files: [
      'src/index.ts',
      'src/scheduler.ts',
      'src/**/index.ts',
    ],
    rules: {
      'check-file/filename-naming-convention': 'off'
    },

  },
);