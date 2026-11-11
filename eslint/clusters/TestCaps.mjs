// @ts-check
/**
 * Skipped-test, statement-count, and helper line-count guards for the
 * test tree and their canaries.
 */
import sonarjs from 'eslint-plugin-sonarjs';
import {
  PHASE_9_TEST_FILES,
  PHASE_10_INTEGRATION_FILES,
  PHASE_10_WAVE_2_PIPELINE_HARDENING_TESTS,
  phase9LocalPlugin,
} from '../rules/Phase9Plugin.mjs';

export const TEST_CAP_BLOCKS = [
  // 19.6 SKIPPED-TEST BAN — extend `sonarjs/no-skipped-tests` (S1607)
  // to ALL `src/Tests/**`. Previously scoped out (§11 ignores) so
  // `describe.skip(...)` could silently land. Probe confirmed S1607
  // fires on UNCONDITIONAL `describe.skip('...')` only — the
  // creds-gated `hasCreds ? describe : describe.skip` pattern used in
  // E2eReal/E2eFull tests is NOT caught (it accesses `.skip` as a
  // property reference, not a call), so legitimate creds-gating
  // stays allowed without exceptions.
  {
    files: ['src/Tests/**/*.ts'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/no-skipped-tests': 'error',
    },
  },

  // 19.8 TEST STATEMENT CAP — extend `max-statements` to `src/Tests/**`.
  // Tests legitimately have long `describe(...)` / `it(...)` arrow
  // callbacks (setup + multiple assertions), so we keep
  // `max-lines-per-function: 'off'` from §7. But `max-statements: 30`
  // is a meaningful cap: it catches truly bloated test functions
  // (a single test with 30+ statements is doing too much) without
  // touching the natural arrow-callback length of describe-blocks.
  // Phase 9 should drive this cap down to 15.
  {
    files: ['src/Tests/**/*.ts'],
    rules: {
      'max-statements': ['error', 30],
    },
  },

  // 19.9 CANARY — TEST-HELPER FUNCTION-DECLARATION ≤10-STMT CAP.
  //
  // The §19.9 rule (defined inline in §4 + §5) bans FunctionDeclaration
  // bodies > 10 stmts inside `src/Tests/**`.
  //
  // The canary-only block that used to live here re-enabled the rule on one
  // fixture under `EslintCanaries/` — and, being a `no-restricted-syntax`
  // re-declaration, it REPLACED the whole set for that file, leaving it with
  // exactly one selector. §22 now arms the rule across every canary as part
  // of the canary contract, so a single fixture no longer buys its coverage
  // by discarding everyone else's.

  // 19.10 TEST-HELPER LINE CAP — `fn-declaration-max-lines:10` on the
  // 6 Phase 9 files. Closes the lines-vs-statements gap CR cycle 2
  // exposed (named helpers of 21 lines / 5 stmts slipped through §19.9
  // because AST selectors cannot compute line counts). Phase 10 master
  // plan extends the `files:` glob to all `src/Tests/**` in waves.
  {
    files: PHASE_9_TEST_FILES,
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 19.10 PHASE 10 WAVE 1 — extend `fn-declaration-max-lines:10` to the
  // Integration tree under `src/Tests/Integration/**` and its companion
  // unit tests. Closes the gap CR cycle 4b exposed (17 helper functions
  // >10 lines slipped through because the directory was not in the
  // §19.10 allowlist). Future Integration files inherit automatically
  // via the glob. No file is grandfathered: every remaining file
  // already complies with the cap.
  {
    files: PHASE_10_INTEGRATION_FILES,
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 19.10 CANARY — re-enable the rule on a single fixture under
  // `EslintCanaries/` (globally ignored at line 539) so `verify.sh` can
  // confirm the guardrail stays armed. Fixture is 12 lines / 5 stmts —
  // proves §19.10 fires on a function §19.9 would miss.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/test-helper-over-10-lines.canary.ts'],
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 19.11 PHASE 10 WAVE 2 — Pipeline coverage-closeout tests (PR #336
  // Seq #1) MUST mirror the production ≤10-LoC cap. CR cycle #1 caught
  // a 12-LoC `buildEndpoint` helper inside `ApiOriginDiscovery.test.ts`
  // that ESLint silently allowed — because §7's broad `src/Tests/**`
  // override at line 866 turns `max-lines-per-function` OFF entirely.
  //
  // Why only `phase9-local/fn-declaration-max-lines` here (and NOT the
  // built-in `max-lines-per-function` / `max-statements`): the built-in
  // rules fire on EVERY `describe`/`it` arrow callback (per the §19.10
  // docstring, ~3 049 violators in `src/Tests/**` per AST audit) which
  // makes them unusable on test files. The phase9-local rule fires
  // ONLY on named `FunctionDeclaration`s — exactly the slip-class CR
  // cycle #1 exposed (`function buildEndpoint() {}` over 10 lines).
  // Statement-count enforcement is already provided by
  // `TEST_HELPER_OVER_10_STMTS_RULE` wired into §7's `no-restricted-syntax`
  // at line 877 — so we don't double up here.
  //
  // Globs are deliberately narrow: the 3 files PR #336 added + the
  // Scoring/** glob so future co-located tests inherit. A wave 3
  // widens to all `src/Tests/Unit/Pipeline/**` after the existing
  // 2 317 violators are drained (Phase 9-style sweep).
  {
    files: PHASE_10_WAVE_2_PIPELINE_HARDENING_TESTS,
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 19.11 CANARY — re-enable §19.11 on a single fixture under
  // `EslintCanaries/` (globally ignored at line 539) so `verify.sh`
  // can confirm the wave-2 guardrail stays armed. Fixture is a
  // 14-line named FunctionDeclaration — proves the wave-2 rule
  // fires on the slip-class CR cycle PR #336 #1 exposed.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/test-pipeline-hardening-fn-over-cap.canary.ts'],
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },
];
