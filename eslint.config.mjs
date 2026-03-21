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

/**
 * GLOBAL ARCHITECTURAL GUARDRAILS
 * These apply to all source files to ensure a "Zero-Skip" and Security-First environment.
 */
const RESTRICTED_SYNTAX_RULES = [
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

  // 7. Type Integrity (Blocking 'unknown' bypasses)
  {
    // Blocks 'unknown' in function return types
    selector: ":matches(TSFunctionType, TSMethodDefinition, FunctionDeclaration) > TSTypeAnnotation TSUnknownKeyword",
    message: "🚫 ARCHITECTURE: Functions cannot return 'unknown'. Define a specific Interface or Type.",
  },
  {
    // Blocks 'unknown' in function parameters (Arguments)
    selector: "TSParameterProperty TSUnknownKeyword, FunctionDeclaration TSParameterProperty TSUnknownKeyword, TSTypeReference TSUnknownKeyword",
    message: "🚫 ARCHITECTURE: Function parameters cannot be 'unknown'.",
  },
  {
    //Blocks 'unknown' in variable type annotations
    selector: "VariableDeclarator > TSTypeAnnotation TSUnknownKeyword",
    message: "🚫 TYPE SKIP: Do not declare variables as 'unknown'. Cast them to a concrete type immediately.",
  },

  // Block: for-in loops (can be used to bypass iterators and cause prototype pollution)
  'ForInStatement',
  'LabeledStatement',
  'WithStatement',

  // 8. Anti-Sleep Policy
  {
    // Targets: sleep(1000), await sleep(1000)
    selector: "CallExpression[callee.name='sleep']",
    message: "🚫 BRITTLE LOGIC: 'sleep()' is forbidden. Use a proper 'waitFor' mechanism.",
  },
  {
    // Targets: setTimeout(() => {}, 1000) - often used as a manual sleep
    selector: "CallExpression[callee.name='setTimeout'][arguments.length=2]",
    message: "🚫 BRITTLE LOGIC: Manual 'setTimeout' delays are forbidden.",
  },
  {
    // Targets: delay(1000) - common in some utility libs
    selector: "CallExpression[callee.name='delay']",
    message: "🚫 BRITTLE LOGIC: 'delay()' is forbidden.",
  },

  // 9. Obfuscation & Naming
  {
    // Targets: { original: shortAlias }
    selector: "VariableDeclarator > ObjectPattern > Property[kind='init'][value.name.length<3], ArrowFunctionExpression > ObjectPattern > Property[kind='init'][value.name.length<3]",
    message: "🚫 OBFUSCATION: Do not use short aliases. Use descriptive names.",
  },
  {
    // Prevents generic descriptions like 'test', 'run', or 'batch'
    selector: "CallExpression[callee.name='describe'] > Literal[value=/^(test|run|batch|suite)/i]",
    message: "🚫 GENERIC DESCRIPTION: Use the Feature Name in the describe block.",
  }
];

export default tseslint.config(
  // 1. GLOBAL IGNORES
  {
    ignores: ['.github/**', 'lib/**', 'node_modules/**', 'coverage/**', 'src/coverage/**', 'tsup.config.ts', '**/*.js', '**/*.mjs', '**/*.cjs'],
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
      globals: { ...globals.node, ...globals.jest, ...globals.es2021, document: 'readonly', window: 'readonly', fetch: 'readonly', Headers: 'readonly' },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-console': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'istanbul ignore', 'c8 ignore', 'v8 ignore', '@ts-ignore', '@ts-nocheck', '@ts-expect-error', 'eslint-disable'], location: 'anywhere' }],
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES],
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': true, minimumDescriptionLength: 10 }],
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Imports
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/max-dependencies': ['error', { max: 15, ignoreTypeImports: true }],

      // Style & Return Types
      'quotes': ['error', 'single', { avoidEscape: true }],
      // Force explicit 'public', 'private', or 'protected'
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit', overrides: { constructors: 'no-public' } }],
      // Force explicit return types (including : void)
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: false, allowTypedFunctionExpressions: true, allowHigherOrderFunctions: true, allowDirectConstAssertionInArrowFunctions: true }],
      'import-x/prefer-default-export': 'error',
      'no-nested-ternary': 'error',
      'class-methods-use-this': 'error',
      'arrow-body-style': 'off',
      'no-shadow': 'off',
      'no-await-in-loop': 'error',

      // Type Safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Unused Code
      'no-unused-vars': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

      // Naming
      'check-file/filename-naming-convention': ['error', { 'src/**/*.{ts,tsx}': 'PASCAL_CASE' }],
      'check-file/folder-naming-convention': ['error', { 'src/**/': 'PASCAL_CASE' }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: true } },
        { selector: ['variable', 'function', 'method'], format: ['camelCase'] },
        { selector: 'variable', types: ['boolean'], format: ['PascalCase'], prefix: ['is', 'has', 'should', 'can', 'did', 'will', 'was'] },
        { selector: 'variable', modifiers: ['const', 'global'], format: ['UPPER_CASE'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'classProperty', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'require' },
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

      // JSDoc
      'jsdoc/require-jsdoc': ['error', { publicOnly: false, require: { FunctionDeclaration: true, MethodDefinition: true, ClassDeclaration: true, ArrowFunctionExpression: true, FunctionExpression: true } }],
      'jsdoc/require-description': ['error', { contexts: ['any'] }],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-param-type': 'off', // TS handles types
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-returns-type': 'off', // TS handles types
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',

      // Limits
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      'complexity': ['error', { max: 10 }],
      'max-classes-per-file': ['error', 1],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-len': ['error', { code: 100, ignoreUrls: true, ignoreStrings: true, ignoreComments: true }],
    },
  },

  // 4. TEST / MOCK (RELAXED)
  {
    files: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/Tests/**/*.ts', '**/mocks/**/*.ts', 'eslint.config.mjs'],
    rules: {
      'no-console': 'off',// Allow logging in tests
      'max-lines-per-function': 'off',// Tests are naturally long
      'max-len': 'off',// Test descriptions can be long
      'check-file/filename-naming-convention': 'off',// Allow standard test naming
    },
  },

  // 5. PIPELINE TESTS: STRUCTURE ENFORCEMENT
  {
    files: ['src/Tests/**/Pipeline/**/*.ts'],
    rules: {
      'check-file/filename-naming-convention': ['error', { 'src/Tests/**/*.{test,spec}.ts': 'PASCAL_CASE' }, { ignoreMiddleExtensions: true }],
      'check-file/folder-naming-convention': ['error', { 'src/Tests/**/Pipeline/**/': 'PASCAL_CASE' }],
      'check-file/folder-match-with-fex': ['error', { '*.test.ts': '**/(Unit|E2E|Scrapers)/Pipeline/**' }],
    },
  },

  // 6. PIPELINE LOGIC (DI, MEDIATOR, HANDLERS & RESULT PATTERN)
  {
    files: ['src/Scrapers/Pipeline/**/*.ts'],
    rules: {
      // 1. Dependency Injection & Mediator Boundary
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/Registry/Config/**'],
            message: '🚫 DI: Use ctx.config — do not import ScraperConfig directly.'
          },
          {
            group: ['**/Constants/**', '**/env'],
            message: '🚫 DI: Use ctx.config instead of direct imports.'
          },
          {
            group: ['**/Mediator/Internals/**'],
            message: '🚫 MEDIATOR: Access HTML resolution only via ctx.mediator.'
          }
        ]
      }],

      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        // DI: Block ALL manual instantiation except builtins
        // GAP FIX #2 — Broadened from /Config$/ to catch all new Xxx()
        {
          // Add your safe classes to the negative lookahead (the ?! section)
          selector: "NewExpression[callee.name=/^(?!Error|Map|Set|Date|RegExp|URL|Headers|ScraperError|PipelineBuilder)[A-Z]/]",
          message: "🚫 DI ENFORCEMENT: Do not instantiate classes directly. Inject via PipelineContext.",
        },

        // Handler Delegation: Phases must call handlers
        {
          selector: "ClassDeclaration[id.name=/Phase$/] MethodDefinition[key.name='execute'] BlockStatement > :not(ExpressionStatement[expression.callee.property.name=/handle|executeHandler/]):not(ReturnStatement)",
          message: "🚫 ARCHITECTURE: Phase logic must be delegated to a Handler. Use ctx.handlers.execute().",
        },

        // No else blocks — guard clauses only
        {
          selector: "IfStatement[alternate]",
          message: "🚫 'else' blocks are disallowed. Use early returns (Guard Clauses).",
        },

        // No ternary — use logical lookups
        {
          selector: "ConditionalExpression",
          message: "🚫 Ternary operators are disallowed. Use logical lookups.",
        },

        // Result Pattern: No primitive returns
        {
          selector: "TSMethodDefinition[key.name!=/^(constructor|setup|init)$/] > TSTypeAnnotation > :matches(TSStringKeyword, TSNumberKeyword, TSBooleanKeyword)",
          message: "🚫 RESULT PATTERN: Do not return primitives directly. Return an IScraperResult.",
        },

        // Result Pattern: Every return must have success/status
        {
          selector: "ReturnStatement > ObjectExpression:not(:has(Property[key.name='success'])):not(:has(Property[key.name='status']))",
          message: "🚫 RESULT PATTERN: Every return object must include 'success: boolean' AND 'status: string'.",
        },

        // Result Pattern: Failure must include message/error
        {
          selector: "ReturnStatement > ObjectExpression:has(Property[key.name='success'][value.value=false]):not(:has(Property[key.name=/message|error/]))",
          message: "🚫 RESULT PATTERN: On failure (success: false), you MUST provide a 'message' or 'error' string.",
        },

        // Result Pattern: No throw
        {
          selector: "ThrowStatement",
          message: "🚫 RESULT PATTERN: Do not throw. Return a failure Result object instead.",
        },

        // Pagination: No manual while loops — use Pagination strategy
        // GAP FIX #4 — Forces pagination abstraction
        {
          selector: "WhileStatement",
          message: "🚫 PAGINATION: Do not use manual while loops. Use the Pagination strategy abstraction.",
        },
        {
          selector: "DoWhileStatement",
          message: "🚫 PAGINATION: Do not use manual do-while loops. Use the Pagination strategy abstraction.",
        },
        // GUARD: Prevent swallowing aggregate errors
        {
          selector: "CallExpression[callee.object.name='Promise'][callee.property.name='any']",
          message: "🚫 CONCURRENCY: Promise.any() swallows errors. Use Promise.allSettled() to ensure we log WHY every attempt failed.",
        },

        // GUARD: Prevent transforming Errors into "Empty Success"
        {
          selector: "IfStatement[test.argument.property.name='isOk'] ReturnStatement > ArrayExpression[elements.length=0]",
          message: "🚫 DATA INTEGRITY: Do not return an empty array [] on failure. This triggers false 'Zero Data' states. Propagate the failure Result instead.",
        },
        // DI: No hardcoded Config keys in Objects
        {
          selector: "Property[key.name=/viewport|width|height|timeout|delay|retries/i] > Literal",
          message: "🚫 DI: Config values (timeouts/dimensions) must be injected via 'ctx.config'.",
        },

        // DI: No hardcoded Browser/Framework API Arguments
        {
          selector: "CallExpression[callee.property.name=/goto|waitForTimeout|setViewport|setTimeout|waitForSelector|click|type/] > Literal",
          message: "🚫 DI: Browser interactions must use selectors/URLs from 'ctx.constants' or 'ctx.config'.",
        },

        // DI: No manual instantiation of Service/Logic classes
        {
          selector: "NewExpression[callee.name=/^(?!Error|Map|Set|Date|RegExp|URL|Headers|ScraperError|PipelineBuilder)[A-Z]/]",
          message: "🚫 DI: Do not 'new' up handlers or services. Inject via PipelineContext.",
        },

        // ARCHITECTURE: No hardcoded Status Strings
        {
          selector: "BinaryExpression[operator='==='] > Literal[value=/^(success|failure|pending|error|done)$/i]",
          message: "🚫 ARCHITECTURE: Use Enums or Constants for type discriminators/status checks.",
        }
      ],
      'no-else-return': ['error', { allowElseIf: false }],
      'max-depth': ['error', 1],
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: false, allowTypedFunctionExpressions: false }],
    },
  },
  // 6. PIPELINE INFRASTRUCTURE (THE EXCEPTIONS)
  // This block grants "super-powers" to the files that build the DI container.
  {
    files: [
      'src/Scrapers/Pipeline/**/*{Strategy,Scraper,Pipeline,Executor,Context}.ts'
    ],
    rules: {
      // Factories are allowed to use 'new' and 'import' from Registry
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES],
      'no-restricted-imports': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'max-lines-per-function': 'off',
    },
  },

  // 7. ENTRY POINT EXEMPTIONS
  {
    files: ['src/index.ts', 'src/scheduler.ts', 'src/**/index.ts'],
    rules: { 'check-file/filename-naming-convention': 'off' },
  },
);