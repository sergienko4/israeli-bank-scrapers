// Canary: §19.10 — test-helper FunctionDeclaration ≤10-line cap.
//
// The §19.10 rule (defined as `phase9-local/fn-declaration-max-lines`
// in eslint.config.mjs via an inline plugin) bans named-FunctionDeclaration
// helpers whose body exceeds 10 LINES (not statements). It closes the gap
// CR cycle 2 exposed in PR #305: a helper of 21 lines / 5 statements
// (`buildMediatorWithEndpoints` in DashboardPhase.test.ts) slipped through
// §19.9 because the AST selector grammar cannot compute line counts.
//
// This canary lives outside `src/Tests/**` (it is in `EslintCanaries/`
// which is globally ignored at eslint.config.mjs:539) but is opted
// back in by the §19.10-canary single-file block so `verify.sh` can
// confirm the guardrail stays armed.
//
// The function body below spans exactly 12 LINES and contains only
// 5 STATEMENTS — proving §19.10 fires where §19.9 would miss. Do NOT
// shrink this body. Do NOT add suppression directives — the project's
// no-suppression rule (and the §19.10 contract) bars silencing this
// canary.

/**
 * Padded helper used purely as an ESLint fixture for the §19.10
 * test-helper FunctionDeclaration ≤10-line cap. Proves the rule
 * fires on a function §19.9 would miss (5 statements, 12 lines).
 * @returns The literal 42 (irrelevant — value is unused).
 */
function canaryTestHelperOverTenLines(): number {
  const obj = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
  };
  return obj.first + obj.second + obj.third + obj.fourth + obj.fifth + obj.sixth;
}

/** Second named export — keeps `import-x/prefer-default-export` quiet. */
const CANARY_LABEL_LINES = '§19.10-test-helper-over-10-lines' as const;

export { CANARY_LABEL_LINES, canaryTestHelperOverTenLines };
