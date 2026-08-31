/**
 * ESLint canary — init-cluster-fn-over-cap.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: PR #288 Section 14 per-function size guard — asserts
// `max-lines-per-function: 10` fires on Mediator/Init/ sub-modules.
// The Init/ cluster was tightened from the lax 20-cap default to 10
// after CodeRabbit (R3-1..R3-5) caught 24 grandfathered over-cap fns
// that pre-commit had silently allowed. The single function below is
// padded above the 10 skipBlankLines + skipComments ceiling so
// verify.sh confirms the rule fires.

function canaryInitFunctionOverCap(): number {
  const s1 = 1;
  const s2 = s1 + 1;
  const s3 = s2 + 1;
  const s4 = s3 + 1;
  const s5 = s4 + 1;
  const s6 = s5 + 1;
  const s7 = s6 + 1;
  const s8 = s7 + 1;
  return s8;
}

export { canaryInitFunctionOverCap };
