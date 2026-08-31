/**
 * ESLint canary — mediator-auth-fn-over-cap.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: Phase 2d lockdown per-function size guard — asserts the
// §14b.3 full three-rule lock (`max-statements: 10` +
// `max-lines-per-function: 10` + `max-lines: 150`) fires on
// Mediator/Login/, Mediator/PreLogin/ and Mediator/AuthDiscovery/
// sub-modules. Phase 2d extracted 25 over-cap functions across 7
// files in the Auth triad down to ≤10 statement/LoC bodies; this
// canary + the eslint.config.mjs §14b.3 override block guarantees
// no regression can reintroduce a >10-statement / >10-LoC function
// in any of the three Auth clusters.

function canaryAuthFunctionOverCap(): number {
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

export { canaryAuthFunctionOverCap };
