/**
 * ESLint canary — mediator-dashboard-fn-over-cap.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: Phase 2c lockdown per-function size guard — asserts the
// §14b.2 full three-rule lock (`max-statements: 10` +
// `max-lines-per-function: 10` + `max-lines: 150`) fires on
// Mediator/Dashboard/ sub-modules. Phase 2c extracted 31 over-cap
// functions across 7 files in the Dashboard cluster down to ≤10
// statement/LoC bodies (commit `ec30d4ad`); this canary + the
// eslint.config.mjs §14b.2 override block guarantees no regression
// can reintroduce a >10-statement / >10-LoC function in the cluster.
// File caps (`max-lines: 150`) are enforced cluster-wide by the
// lockdown and proved by the sibling
// `mediator-dashboard-file-over-cap.canary.ts`.

function canaryDashboardFunctionOverCap(): number {
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

export { canaryDashboardFunctionOverCap };
