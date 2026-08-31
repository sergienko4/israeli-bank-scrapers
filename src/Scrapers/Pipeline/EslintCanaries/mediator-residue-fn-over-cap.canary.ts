/**
 * ESLint canary — mediator-residue-fn-over-cap.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: Phase 2e lockdown per-function size guard — asserts the
// §14b.4 full three-rule lock (`max-statements: 10` +
// `max-lines-per-function: 10` + `max-lines: 150`) fires on all
// 11 residue Mediator sub-clusters: BalanceResolve/, AccountResolve/,
// OtpFill/, OtpTrigger/, Scrape/, Otp/, Browser/, Home/, Credentials/,
// Terminate/, Timing/. Phase 2e extracted 64 over-cap functions across
// 26 files in these clusters down to ≤10 statement/LoC bodies; this
// canary + the eslint.config.mjs §14b.4 override block guarantees no
// regression can reintroduce a >10-statement / >10-LoC function in
// any of the 11 residue sub-clusters.

function canaryResidueFunctionOverCap(): number {
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

export { canaryResidueFunctionOverCap };
