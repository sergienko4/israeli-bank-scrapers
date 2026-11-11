// @ts-check
/**
 * The inline `phase9-local/fn-declaration-max-lines` rule and the test
 * file waves it is armed on.
 */
// §19.10 TEST-HELPER LINE CAP — fires on any
// `function foo() { ...12+ lines }` inside the Phase 9 files. Complements
// §19.9 (which counts statements only). CR cycle 2 exposed the gap:
// a helper of 21 lines / 5 statements slipped through §19.9 because the
// AST selector grammar cannot compute `loc.end.line - loc.start.line`.
//
// Implemented as a tiny inline plugin (ESLint v9 flat-config supports
// this via `plugins: { 'phase9-local': ... }`) because the built-in
// `max-lines-per-function` rule cannot filter by AST node type, and
// enabling it globally on `src/Tests/**` would fire on every long
// `describe`/`it` arrow callback (3,049 violators per AST audit).
//
// Scope: Phase 9's 6 touched files only. A future "Phase 10 — Tests
// strict 10/10" master plan extends the `files:` glob in waves
// (analogous to §19.1→§19.5 grandfather drains in production).
const phase9LocalPlugin = {
  meta: { name: 'phase9-local', version: '1.0.0' },
  rules: {
    'fn-declaration-max-lines': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Cap named FunctionDeclaration bodies by total line count (excludes arrow callbacks of describe/it/it.each).',
        },
        messages: {
          tooLong:
            "🚫 §19.10 TEST HELPER LINE CAP: Named test helper '{{name}}' is {{lines}} lines (max {{max}}). Extract focused sub-helpers (Extract Function). Arrow callbacks of describe/it/it.each are exempt (only FunctionDeclaration fires).",
        },
        schema: [
          {
            type: 'object',
            properties: { max: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const max = (context.options[0] && context.options[0].max) || 10;
        return {
          FunctionDeclaration(node) {
            if (!node.id || !node.loc) return;
            const lines = node.loc.end.line - node.loc.start.line + 1;
            if (lines > max) {
              context.report({
                node,
                messageId: 'tooLong',
                data: { name: node.id.name, lines: String(lines), max: String(max) },
              });
            }
          },
        };
      },
    },
  },
};

// §19.10 enforcement scope — Phase 9 6 files + Phase 10 wave 1 (Integration).
// The Integration tree (`src/Tests/Integration/**`) holds the PII redactor,
// the fixture-root locator and the committed bank fixtures. CR cycle 4b
// flagged 17 helper functions over the 10-line cap there that §19.10 would
// have caught at lint time — but the directory was not in this allowlist.
// Extending the glob enforces the cap going forward on every new file
// under that subtree.
const PHASE_9_TEST_FILES = ['src/Tests/E2eReal/Helpers.ts'];

// Phase 10 wave 1 — Integration tree. Glob form so
// future Integration files inherit the cap automatically.
const PHASE_10_INTEGRATION_FILES = [
  'src/Tests/Integration/**/*.ts',
  'src/Tests/Unit/Integration/**/*.ts',
];

// Phase 10 wave 2 — Pipeline coverage-closeout tests (PR #336 Seq #1).
// Closes the gap CR cycle PR #336 #1 exposed: `buildEndpoint` shipped
// at 12 LoC inside `ApiOriginDiscovery.test.ts`, but §7's broad
// `src/Tests/**` override at line 866 turns `max-lines-per-function`
// OFF entirely, so the ≤10-LoC cap from CLEAN_CODE.md §1 + CLAUDE.md
// (Max 10 lines per method) was unenforceable. This wave re-arms the
// cap on NEW pipeline-mirroring tests via:
//   • `phase9-local/fn-declaration-max-lines:10` — line-count guard on
//     `FunctionDeclaration` only. The built-in `max-lines-per-function`
//     and `max-statements` rules are deliberately NOT added because they
//     fire on every `describe`/`it`/`beforeEach` arrow callback (see
//     §19.10 docstring — ~3 049 violators across `src/Tests/**`).
//   • Statement-count enforcement on named helpers already comes from
//     `TEST_HELPER_OVER_10_STMTS_RULE` wired into §7's `no-restricted-
//     syntax` block at line 877 — no new `max-statements` override is
//     needed here.
// Globs are deliberately narrow: the touched files + their immediate
// directories. A future "wave 3" widens to all `src/Tests/Unit/Pipeline/**`
// after the existing 2 317 violators are drained (Phase 9-style sweep).
const PHASE_10_WAVE_2_PIPELINE_HARDENING_TESTS = [
  'src/Tests/Unit/Pipeline/Types/PiiRedactor/JsonBody.test.ts',
];

export {
  PHASE_9_TEST_FILES,
  PHASE_10_INTEGRATION_FILES,
  PHASE_10_WAVE_2_PIPELINE_HARDENING_TESTS,
  phase9LocalPlugin,
};
