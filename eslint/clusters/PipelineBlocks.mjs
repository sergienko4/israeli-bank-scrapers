// @ts-check
/**
 * Pipeline logic, type-only exemptions, phase-root guard, and the
 * balance default-deny guard.
 */
import checkFile from 'eslint-plugin-check-file';
import importPlugin from 'eslint-plugin-import-x';
import sonarjs from 'eslint-plugin-sonarjs';
import { BALANCE_DEFAULT_DENY_RULES } from '../rules/GuardRules.mjs';
import { PIPELINE_SYNTAX_RULES } from '../rules/PipelineContract.mjs';

export const PIPELINE_BLOCKS = [
  // 6. PIPELINE LOGIC (DI, MEDIATOR, HANDLERS & RESULT PATTERN)
  // 6. PIPELINE LOGIC (STRICT ARCHITECTURAL ENFORCEMENT)
  {
    files: ['src/Scrapers/Pipeline/**/*.ts'],
    plugins: {
      'check-file': checkFile,
      'import-x': importPlugin,
      sonarjs,
    },
    rules: {
      // --- A. THE "NESTED OR DEATH" GATE ---
      'check-file/folder-naming-convention': [
        'error',
        {
          'src/Scrapers/Pipeline/Phases/*/': 'PASCAL_CASE',
          'src/Scrapers/Pipeline/Mediator/*/': 'PASCAL_CASE', // <--- FORCES MEDIATOR SUBFOLDERS
          'src/Scrapers/Pipeline/Strategy/*/': 'PASCAL_CASE', // FORCES SUBFOLDERS
        },
      ],
      'check-file/filename-naming-convention': [
        'error',
        {
          // FORCES THE 4-STAGE LIFECYCLE + MEDIATOR ACTIONS
          'src/Scrapers/Pipeline/Phases/**/*{Pre,Action,Post,Reveal,Step,Phase}.ts': 'PASCAL_CASE',
          'src/Scrapers/Pipeline/Mediator/**/*Action.ts': 'PASCAL_CASE',
          'src/Scrapers/Pipeline/Strategy/**/*Strategy.ts': 'PASCAL_CASE',
        },
      ],

      // --- B. THE GLOBAL ARCHITECTURAL FORCE ---
      // This applies to ALL files in Pipeline, including Mediator and Strategy.
      // CodeRabbit-class selectors (PR #257) appended here so the same
      // patterns are caught at pre-commit time instead of in review.
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES],

      // --- C. DEFAULT COMPLEXITY (STRICT) ---
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-depth': ['error', 1],

      // --- D. PR #261 REVIEW VALIDATORS ---
      // V3 — surface unguarded conditionals that ESLint can statically
      // prove are always-truthy or always-falsy. CodeRabbit caught the
      // `(creds.phoneNumber as unknown as string) ?? ''` pattern this
      // way; the rule keeps future double-cast-then-null-coalesce out.
      '@typescript-eslint/no-unnecessary-condition': 'error',
      // V2 — flag any string literal that repeats 3+ times in one file
      // without being lifted to a named constant. CodeRabbit's CR2 was
      // a hardcoded `'5.6.6'` / `'android-13'` / `'pb'` set at module
      // scope in PayBoxShapeTxns; the rule keeps that class of "magic
      // string trio" out at pre-commit.
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      // V4 — surface dead `await` keywords (CodeRabbit CR9's `await
      // Promise.resolve()` in ApiDirectScrapePhase.post) AND the
      // dual-form bug where `return await` inside try/catch is fine
      // but outside it is wasted work. Both rules complement each
      // other: `no-return-await` covers the syntactic case,
      // `await-thenable` rejects awaits on plain values that can't be
      // a Promise.
      'no-return-await': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  // 7b. TYPE-ONLY DOMAIN MODULES — DEFAULT-EXPORT EXEMPTION
  //
  // CodeRabbit feedback on PR #274: scope the
  // `import-x/prefer-default-export` exemption narrowly to the
  // `Types/Domain/**` folder so {Mediator,Strategy,Types-root}
  // files continue to enforce the global rule. A type-only module
  // such as `Domain/BrowserState.ts` that exports a single
  // `interface IBrowserState` has nothing to default-export (a
  // default export is a runtime concept); the rule fires unhelpfully
  // there. Scoping to `Types/Domain/**` keeps the protection where
  // it adds value and removes the over-broad disable.
  //
  // Phase 8.5c / Commit C2 — add the global ≤10-LoC function cap
  // (`max-lines-per-function: 10`) so type-only domain files are
  // measured by the same yardstick as production modules. Type
  // declarations are zero-LoC contributions; helpers and any
  // future runtime code in this folder must fit within 10 LoC.
  {
    files: [
      'src/Scrapers/Pipeline/Types/Domain/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/types-domain-fn-over-10.canary.ts',
    ],
    rules: {
      'import-x/prefer-default-export': 'off',
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 7c. API-DIRECT-CALL CONFIGCONTRACTS — DEFAULT-EXPORT EXEMPTION
  //
  // Phase 8 split: the `ConfigContracts/` sub-tree under
  // `ApiDirectCall/` houses focused, type-only modules carved out of
  // the former IApiDirectCallConfig god-file. Most files re-export
  // multiple symbols, but the top-level composer
  // `ApiDirectCallConfig.ts` legitimately exports a single
  // `interface IApiDirectCallConfig` — and interfaces cannot be
  // default-exported as values. Same rationale as 7b; same narrow
  // scope.
  {
    files: ['src/Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/**/*.ts'],
    rules: {
      'import-x/prefer-default-export': 'off',
    },
  },

  // 7d. TIMING DOMAIN MODULES — DEFAULT-EXPORT EXEMPTION (Phase 12b)
  //
  // Phase 12b (v8.5) split the former 481-LoC
  // `Mediator/Timing/TimingConfig.ts` hub into per-phase domain
  // files (`OtpTimingConfig.ts`, `TerminateTimingConfig.ts`, ...). Some
  // phases own exactly one budget — `TerminateTimingConfig.ts` only
  // exposes `TERMINATE_CLEANUP_BUDGET_MS`. Forcing those modules to
  // `export default` would require every importer to bind a local
  // alias for a value that is already named at its declaration site.
  // Narrow scope: timing files only — every
  // other Mediator module still enforces the global rule.
  {
    files: ['src/Scrapers/Pipeline/Mediator/Timing/**/*TimingConfig.ts'],
    rules: {
      'import-x/prefer-default-export': 'off',
    },
  },

  // 8. PHASE ROOT GUARD (THE FINAL CHECK)
  {
    files: ['src/Scrapers/Pipeline/Phases/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PIPELINE_SYNTAX_RULES,
        {
          selector: 'Program',
          message:
            '🚫 ARCHITECTURE: Phase files must reside in a Domain subfolder (e.g., Phases/Login/LoginStep.ts).',
        },
      ],
    },
  },

  // 8b. CANARY — TEST-DUPLICATION SONARJS S4144 (single-file scope)
  //
  // Applies sonarjs/no-identical-functions to the dedicated canary
  // fixture so verify.sh can confirm S4144 fires. The rule is already
  // enabled globally at §11 (Pipeline scope; `src/Tests/**` ignored);
  // this single-file override extends it to the EslintCanaries dir for
  // the duplication canary specifically. No production impact.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/test-suite-duplication.canary.ts'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/no-identical-functions': 'error',
    },
  },

  // 8i. BALANCE DEFAULT-ZERO PROHIBITION (PR #264 CR finding #5)
  //
  // `<x>.balance ?? 0` (or `?? null`) makes "balance unknown" identical
  // to a real zero, so PipelineResult cannot fall back to a legacy
  // SCRAPE value. Per coding-principle-guidlines §4 DEFAULT-DENY: skip
  // the slot, do not silently default.
  //
  // Scope = api-direct phase that emits balanceResolution; canary in §22a.
  {
    files: ['src/Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, ...BALANCE_DEFAULT_DENY_RULES],
    },
  },

  // 9. INDEX FILES EXCEPTION
  {
    files: ['**/index.ts'],
    rules: {
      'check-file/filename-naming-convention': 'off',
    },
  },
];
