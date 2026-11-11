// @ts-check
/**
 * Relaxed test/mock rules and the structural enforcement applied to
 * Pipeline tests.
 */
import {
  NO_EXPORT_DEFAULT_RULE,
  RULE10_NO_RAW_PAGE_RULE,
  TEST_HELPER_OVER_10_STMTS_RULE,
  TEST_INTEGRITY_NO_AS_NEVER_RULE,
} from '../rules/GuardRules.mjs';
import { RESTRICTED_SYNTAX_RULES } from '../rules/RestrictedSyntax.mjs';

export const TEST_BLOCKS = [
  // 4. TEST / MOCK (RELAXED)
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
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }], // Tests can be longer
      'max-len': 'off', // Test descriptions can be long
      'check-file/filename-naming-convention': 'off', // Allow standard test naming
      // Jest recognises `@jest-environment` as a docblock pragma to switch
      // the test environment per file (e.g. jsdom vs node). It is a real
      // tag from Jest, not a custom invention — whitelist it for tests so
      // jsdoc/check-tag-names does not reject it.
      'jsdoc/check-tag-names': ['error', { definedTags: ['jest-environment'] }],

      //🚨 Prevent the 'as never' / 'as any' bypass in mocks + §19.9 test-helper cap
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES, TEST_HELPER_OVER_10_STMTS_RULE],
    },
  },

  // 5. PIPELINE TESTS: STRUCTURE ENFORCEMENT
  //
  // `src/Tests/Policy/` holds the CI-policy gates that used to live under
  // `src/Tests/Unit/Pipeline/CrossValidation/` (Phase 14). They are listed
  // explicitly so the move does not drop the structural rules that path
  // inherited — a rule scoped to a directory silently stops applying to a
  // file that moves out of it.
  {
    files: ['src/Tests/**/Pipeline/**/*.ts', 'src/Tests/Policy/**/*.ts'],
    rules: {
      'class-methods-use-this': 'off', // Test doubles extend SimplePhase with no-op overrides
      'max-classes-per-file': 'off', // Test doubles need multiple classes per file
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                '🚫 Rule #10: Phases must use the Mediator. Direct Playwright imports are forbidden in Pipeline logic.',
            },
          ],
          patterns: [
            {
              group: ['**/Registry/Config/**'],
              message: '🚫 DI: Use ctx.config — do not import ScraperConfig directly.',
            },
            {
              group: ['**/Common/**'],
              message:
                '🚫 ARCHITECTURE: Pipeline Tests must not reference Common/. Use Pipeline local types/mocks.',
            },
          ],
        },
      ],
      'check-file/filename-naming-convention': [
        'error',
        { 'src/Tests/**/*.{test,spec}.ts': 'PASCAL_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        {
          'src/Tests/**/Pipeline/**/': 'PASCAL_CASE',
          // The policy gates moved out of `Pipeline/` in Phase 14; without
          // this key their folders lose the naming check the old path gave
          // them, because this block replaces the repository-wide options.
          'src/Tests/Policy/**/': 'PASCAL_CASE',
        },
      ],
      'check-file/folder-match-with-fex': [
        'error',
        { '*.test.ts': '**/((Unit|E2E|Scrapers)/Pipeline|Policy)/**' },
      ],
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        TEST_INTEGRITY_NO_AS_NEVER_RULE,
        NO_EXPORT_DEFAULT_RULE,
        RULE10_NO_RAW_PAGE_RULE,
        TEST_HELPER_OVER_10_STMTS_RULE,
      ],
    },
  },
];
