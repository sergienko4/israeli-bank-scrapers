// Canary: §19.9 — test-helper FunctionDeclaration ≤10-statement cap.
//
// The §19.9 rule (in eslint.config.mjs, inlined into §4 + §5 via
// TEST_HELPER_OVER_10_STMTS_RULE) bans named-FunctionDeclaration
// helpers in `src/Tests/**` whose body exceeds 10 statements. This
// canary lives outside `src/Tests/**` (it is in `EslintCanaries/`
// which is globally ignored at eslint.config.mjs:539) but is opted
// back in by the §19.9 single-file block so `verify.sh` can confirm
// the guardrail stays armed.
//
// The function body below contains exactly 12 statements so the
// `FunctionDeclaration[body.body.length>10]` AST selector fires.
// Do NOT shrink this body. Do NOT add suppression directives — the
// project's no-suppression rule (and the §19.9 contract) bars
// silencing this canary.

/**
 * Padded helper used purely as an ESLint fixture for the §19.9
 * test-helper FunctionDeclaration ≤10-stmt cap.
 * @returns Twelfth incremental sum (irrelevant — value is unused).
 */
function canaryTestHelperOverTenStatements(): number {
  const a = 1;
  const b = a + 1;
  const c = b + 1;
  const d = c + 1;
  const e = d + 1;
  const f = e + 1;
  const g = f + 1;
  const h = g + 1;
  const i = h + 1;
  const j = i + 1;
  const k = j + 1;
  return k;
}

/** Second named export — keeps `import-x/prefer-default-export` quiet. */
const CANARY_LABEL = '§19.9-test-helper-over-10' as const;

export { CANARY_LABEL, canaryTestHelperOverTenStatements };
