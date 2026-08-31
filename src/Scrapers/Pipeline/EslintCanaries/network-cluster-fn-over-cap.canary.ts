/**
 * ESLint canary — network-cluster-fn-over-cap.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: Phase 4 / PR #276 Section 11 per-function size guard —
// asserts `max-lines-per-function: 10` fires on Network/ sub-modules.
// Phase 8.5a tightened the cap from 20 → 10 after draining the three
// grandfathered files. The single function below is padded above the
// 10 skipBlankLines + skipComments ceiling so verify.sh confirms the
// rule fires.

function canaryFunctionOverCap(): number {
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

export { canaryFunctionOverCap };
