// @ts-check
/**
 * Shared base code, the repo-wide screenshot ban, and the suppression
 * comment bans with their canaries.
 */
import jest from 'eslint-plugin-jest';
import {
  NO_DIRECT_SCREENSHOT_RULE,
  SUPPRESSION_COMMENT_OPTIONS,
} from '../rules/GuardRules.mjs';
import { RESTRICTED_SYNTAX_RULES } from '../rules/RestrictedSyntax.mjs';

export const LEGACY_SUPPRESSION_BLOCKS = [
  // 13. Shared base code keeps the global restricted-syntax contract plus the
  //     no-direct-screenshot rule. The legacy bank-lookup selector that lived
  //     here guarded `SCRAPER_CONFIGURATION.banks[...]`, which was deleted
  //     together with the legacy scraper chain.
  {
    files: ['src/Scrapers/Base/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES, NO_DIRECT_SCREENSHOT_RULE],
    },
  },

  // 14. NO DIRECT page.screenshot() — added 2026-05-21 after PR #248 CI
  //     artifact 7128234088 leaked 18+ post-auth PNGs (run 26207506594).
  //     The pipeline is pure HTTP and has no sanctioned call site, so the
  //     ban carries no allow-list.
  //     Pipeline and Scrapers/Base are excluded here and carry the ban
  //     through their own blocks instead. Both declare extra selectors of
  //     their own, and flat config REPLACES `no-restricted-syntax` options
  //     rather than merging them — so while this block matched them last it
  //     silently overwrote everything they declared. See
  //     `check-syntax-guardrails` for the gate that now proves it cannot
  //     happen again.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/Scrapers/Pipeline/**', 'src/Scrapers/Base/**', 'src/Tests/**'],
    rules: {
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES, NO_DIRECT_SCREENSHOT_RULE],
    },
  },

  // 14a. Contract exemptions are applied in one place at the end of this
  //     config, generated from PIPELINE_SELECTOR_EXEMPTIONS, so they cannot
  //     themselves be overwritten by a later block.

  // 15. NO SUPPRESSION COMMENTS — Phase 2 of Security Hardening 2026-05.
  //     Bans every suppression-comment family on src/** so future
  //     contributors cannot silence a Sonar / TypeScript / Biome /
  //     ESLint / coverage rule instead of fixing the underlying
  //     issue. Routed through ESLint's built-in `no-warning-comments`
  //     rule (terms-array form) because Line/Block AST selectors
  //     (`Line:matches([value*='...'])`) are non-functional in
  //     ESLint 9 + typescript-eslint flat-config — verified
  //     empirically. The terms-array form fires on both Line and
  //     Block comments. Canary fixtures in EslintCanaries/ are
  //     intentionally malformed; excluded via `ignores`, then re-armed
  //     for the two canaries that certify this rule (§15a) — a blanket
  //     ignore is what left `no-suppression-comments.canary.ts` unable to
  //     fire the rule it exists to prove.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/Scrapers/Pipeline/EslintCanaries/**'],
    rules: {
      'no-warning-comments': ['error', SUPPRESSION_COMMENT_OPTIONS],
    },
  },

  // 15a. SUPPRESSION-COMMENT CANARIES — re-arm §15 on the fixtures that
  //      certify it. §15 ignores the whole canary directory because most
  //      canaries carry deliberately-malformed markers; that blanket
  //      exclusion also covered the canary whose entire job is to prove
  //      §15 still fires, so it passed on incidental lint noise instead.
  //      Listed explicitly, not by glob, so adding a canary cannot
  //      silently opt it into a rule it was not written for.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/no-suppression-comments.canary.ts'],
    rules: {
      'no-warning-comments': ['error', SUPPRESSION_COMMENT_OPTIONS],
    },
  },

  // 15b. JEST ASSERTION CANARY — `jest/expect-expect` is scoped to
  //      `src/Tests/Unit/**/*.test.ts`, which the canary directory is not
  //      part of. The canary's own docblock claimed the harness passed
  //      `--rule 'jest/expect-expect: error'`; it never did, so the file
  //      certified nothing. Arming the rule here is the honest spelling.
  //
  //      `globals` matters: eslint-plugin-jest resolves `it` / `test` through
  //      scope and ignores a locally-declared stub, so the canary's original
  //      `declare function it(...)` was itself enough to keep the rule silent.
  //      Declaring the jest globals here is what makes the call recognisable.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/jest-expect-expect.canary.ts'],
    plugins: { jest },
    languageOptions: {
      globals: { it: 'readonly', test: 'readonly', describe: 'readonly', expect: 'readonly' },
    },
    rules: {
      'jest/expect-expect': ['error', { assertFunctionNames: ['expect', 'assert*', 'run*'] }],
    },
  },
];
