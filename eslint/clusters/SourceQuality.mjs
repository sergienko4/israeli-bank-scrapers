// @ts-check
/**
 * E2E start-date enforcement, Sonar parity, readonly fields, Jest
 * assertions, re-export shorthand, and the PiiRedactor function cap.
 */
import jest from 'eslint-plugin-jest';
import unicorn from 'eslint-plugin-unicorn';
import { SONAR_PARITY_IGNORE_GLOBS } from '../../eslint.canary-scope.mjs';
import { RESTRICTED_SYNTAX_RULES } from '../rules/RestrictedSyntax.mjs';

export const SOURCE_QUALITY_BLOCKS = [
  // 10. E2EREAL HAPPY-PATH startDate ENFORCEMENT
  // Every live test must use the shared `defaultStartDate()` helper —
  // never raw `new Date()` (silent 0-day window → false-positive passes
  // that scrape nothing) and never an unbound Identifier or string literal.
  // Selectors target `Property[value.type=...]` so they match only the
  // value side of `startDate: ...`, not the key (which is also Identifier).
  {
    files: ['src/Tests/E2eReal/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        {
          selector: "Property[key.name='startDate'][value.type='NewExpression']",
          message:
            '🚫 ARCHITECTURE: startDate must be `defaultStartDate()` — raw `new Date()` is banned (silent 0-day window).',
        },
        {
          selector: "Property[key.name='startDate'][value.type='Identifier']",
          message:
            '🚫 ARCHITECTURE: startDate must be `defaultStartDate()` — unbound variables are banned (no implicit defaults).',
        },
        {
          selector: "Property[key.name='startDate'][value.type='Literal']",
          message:
            '🚫 ARCHITECTURE: startDate must be `defaultStartDate()` — literal values are banned (use the helper).',
        },
      ],
    },
  },

  // 11. SONARJS + UNICORN PARITY — local equivalents of the 19 SonarCloud
  //     rules that surfaced 661 issues during the v2 cleanup. Catching
  //     them here prevents recurrence at edit time, before commit.
  //
  //     Scope mirrors `sonar-project.properties` `sonar.exclusions`:
  //     active Pipeline production code only. Tests and legacy scrapers
  //     are out of Sonar's scope, so they're out of these rules' scope
  //     too — keeps ESLint and SonarCloud aligned without surfacing
  //     thousands of test-stub issues that don't exist in Sonar.
  //
  //     The list lives in `eslint.canary-scope.mjs` so the parity
  //     canaries in `LintValidator.ts` police exactly this set. See
  //     that file for why it is shared rather than duplicated.
  {
    files: ['src/**/*.ts'],
    ignores: [...SONAR_PARITY_IGNORE_GLOBS],
    rules: {
      // SonarJS — Sonar's own rules
      'sonarjs/no-alphabetical-sort': 'error', // S2871
      'sonarjs/redundant-type-aliases': 'error', // S6564
      'sonarjs/void-use': 'error', // S3735
      'sonarjs/no-invariant-returns': 'error', // S3516 BLOCKER
      'sonarjs/no-identical-functions': 'error', // S4144
      'sonarjs/no-misleading-array-reverse': 'error', // S4043
      'sonarjs/use-type-alias': 'error', // S4323
      'sonarjs/no-skipped-tests': 'error', // S1607
      // Unicorn — modern-JS rules SonarCloud wraps
      // NOTE: `unicorn/prefer-export-from` (S7763) is NOT declared here.
      // It is enforced repo-wide and strict by §12e below, which is a
      // superset of this block's scope. Declaring it twice would let the
      // two copies drift apart — the exact failure that caused PR #500.
      'unicorn/prefer-string-replace-all': 'error', // S7781
      'unicorn/prefer-string-raw': 'error', // S7780
      'unicorn/prefer-at': 'error', // S7755
      'unicorn/no-useless-promise-resolve-reject': 'error', // S7746
      'unicorn/catch-error-name': 'error', // S7718
      'unicorn/prefer-global-this': 'error', // S7764
      'unicorn/prefer-includes': 'error', // S7765
      'unicorn/prefer-array-find': 'error', // S7750
      'unicorn/prefer-array-index-of': 'error', // S7753
      'unicorn/prefer-single-call': 'error', // S7778
      // Built-in
      'prefer-object-spread': 'error', // S6661
    },
  },

  // 12c. QUALITY RULES (Security Hardening 2026-05) — `readonly`
  //      private fields, `node:` protocol prefix for built-in imports.
  //      Both rules close Sonar findings (S2933 + S7772) AND prevent
  //      the same patterns from being reintroduced by future PRs.
  {
    files: ['src/**/*.ts'],
    rules: {
      // S2933 — fields that are never reassigned must be `readonly`.
      // Decision: enable globally because zero collateral hits were
      // observed in the Observe dry-run; the rule guards immutability
      // across every class in the codebase.
      '@typescript-eslint/prefer-readonly': 'error',
      // S7772 — Node built-in imports must use the `node:` prefix so
      // the built-in is distinguished from any third-party npm
      // package that could shadow it (the `events` package exists
      // separately on npm). Decision (Decide §4 RC-9): enable globally
      // at `error`; the 11 collateral hits surfaced by Observe are
      // fixed inline in the same commit so the rule lands with zero
      // outstanding violations.
      'unicorn/prefer-node-protocol': 'error',
    },
  },

  // 12d. JEST ASSERTION RULES (Security Hardening 2026-05) — scoped
  //      to unit tests under `src/Tests/Unit/**` per Decide §4 Q4
  //      (the collateral budget for `jest/expect-expect` on
  //      `src/Tests/E2e*` is 61 hits — out of scope; E2E flow tests
  //      use a throw-based assertion idiom in shared helpers and are
  //      excluded by this override).
  {
    files: ['src/Tests/Unit/**/*.test.ts'],
    plugins: { jest },
    rules: {
      // `assertFunctionNames` teaches `jest/expect-expect` about the
      // project's shape-helper conventions. CrossValidation phase
      // tests already validate `expect(...)` inside helpers named
      // either `assert<Phase>Shape(finalCtx)` (six factories) or
      // `run<Phase>ForRow(row)` (FullFlow + InitPhase factories);
      // the rule's default name list (just `expect`) misses both
      // and forces redundant inline assertions. Per CodeRabbit
      // feedback on PR #248, recognising the `assert*` and `run*`
      // names lets each helper be the single source of truth and
      // removes the duplicate-assertion noise.
      'jest/expect-expect': ['error', { assertFunctionNames: ['expect', 'assert*', 'run*'] }],
      'jest/no-standalone-expect': 'error',

      // `@typescript-eslint/unbound-method` cannot see that `expect(obj.method)`
      // never calls the reference — it only inspects it — so it reports every
      // `expect(page.waitForURL).toHaveBeenCalled()` assertion as an unsafe
      // unbound reference. `jest/unbound-method` is the Jest-aware extension of
      // the SAME rule, published by typescript-eslint/eslint-plugin-jest for
      // exactly this pairing: it keeps the check everywhere else in the file and
      // only exempts the `expect()` argument position. This is a swap, not a
      // relaxation — the base rule stays 'error' for all non-test code.
      // See https://typescript-eslint.io/rules/unbound-method/#how-to-use (Jest note).
      '@typescript-eslint/unbound-method': 'off',
      'jest/unbound-method': 'error',
    },
  },

  // 12e. RE-EXPORT SHORTHAND (`unicorn/prefer-export-from`, Sonar
  //      `typescript:S7763`) — REPO-WIDE AND STRICT.
  //
  //      This is the SINGLE declaration of the rule. §11 deliberately
  //      omits it and points here.
  //
  //      History — why the scope is now global:
  //      • 2026-05 (Security Hardening) introduced this block scoped to
  //        `src/Scrapers/Base/**` only, keeping the global default loose
  //        so the collateral hits elsewhere stayed out of that PR.
  //      • PR #274 extended the scope to `src/Scrapers/Pipeline/Types/**`
  //        after 11 more instances surfaced there, and recorded that the
  //        Sonar failure "cannot recur".
  //      • It recurred. PR #500 hit 32 S7763 issues under
  //        `src/Scrapers/Pipeline/Banks/**` — a folder no one had
  //        enumerated. Enumerating folders one incident at a time only
  //        ever covers the folders that already failed.
  //
  //      The whole `src` tree was converted to `export ... from` in the
  //      commits preceding this one, so the strict rule starts from a
  //      verified zero-violation baseline and no grandfather override is
  //      needed. `files: ['src/**/*.ts']` intentionally also covers the
  //      Sonar-excluded paths (`src/Tests/**`, `src/Common/**`, legacy
  //      scrapers, `src/Scrapers/Registry/**`): keeping them clean costs
  //      nothing now and removes the next enumeration gap.
  //
  //      Canary: `re-export-shorthand.canary.ts`. `EslintCanaries/**` is
  //      globally ignored (§1), but `verify.sh` lints with `--no-ignore`,
  //      so `files:` matching still governs — `src/**/*.ts` covers it and
  //      the previous single-file entry is no longer required. The canary
  //      exports a locally-used imported binding, so it only fires while
  //      `checkUsedVariables` is `true`; if that flag is ever loosened the
  //      canary goes silent and `verify.sh` fails it as dead.
  //
  //      2026-06-08 compat: eslint-plugin-unicorn v65 renamed the legacy
  //      `ignoreUsedVariables: boolean` option to `checkUsedVariables`
  //      with inverted semantics. Mapping: `ignoreUsedVariables: true`
  //      ↔ `checkUsedVariables: false` (loose); `ignoreUsedVariables:
  //      false` ↔ `checkUsedVariables: true` (strict). v65 rejects the
  //      legacy key outright ("should NOT have additional properties").
  {
    files: ['src/**/*.ts'],
    plugins: { unicorn },
    rules: {
      'unicorn/prefer-export-from': ['error', { checkUsedVariables: true }],
    },
  },

  // 12f. PII REDACTOR CLUSTER — PER-FUNCTION ≤10-LoC CAP
  //
  // Phase 8.5c / Commit C2 — lock in the §13A `PiiRedactor/Facade.ts`
  // grandfather drain (split into Routing + Dispatch + Composer in
  // C1) by enforcing the global ≤10-LoC function cap across the whole
  // PiiRedactor cluster. The split modules already comply; this rule
  // prevents any future contributor from re-introducing the long
  // helper functions that §13A was created to tolerate.
  //
  // Broader `Pipeline/Types/**` + `Scrapers/Base/**` per-function-cap
  // rollout is deferred to a follow-up phase — those folders contain
  // 60+ pre-existing long functions (BasePhase, FixtureCapture,
  // Debug, RunLabel, …) that legitimately need surgical extraction
  // work beyond Phase 8.5c's scope (see status.txt deferral entry).
  {
    files: ['src/Scrapers/Pipeline/Types/PiiRedactor/**/*.ts'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
];
