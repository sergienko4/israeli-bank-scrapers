// Canary: Phase 2c lockdown per-function size guard — asserts
// `max-lines-per-function: 10` fires on Mediator/Dashboard/ sub-
// modules. Phase 2c extracted 31 over-cap functions across 7 files
// in the Dashboard cluster down to ≤10 LoC bodies (commit `ec30d4ad`);
// this canary + the eslint.config.mjs override block guarantees no
// regression can reintroduce a > 10-LoC function in the cluster.
// File caps (`max-lines: 150`) are NOT applied yet — DashboardPhase
// Actions.ts remains 1861 LoC; that hardening is deferred to a
// future Phase 2f sub-phase per the §15 Init/ precedent.

function canaryDashboardFunctionOverCap(): number {
  const s1 = 1;
  const s2 = s1 + 1;
  const s3 = s2 + 1;
  const s4 = s3 + 1;
  const s5 = s4 + 1;
  const s6 = s5 + 1;
  const s7 = s6 + 1;
  const s8 = s7 + 1;
  const s9 = s8 + 1;
  const s10 = s9 + 1;
  const s11 = s10 + 1;
  const s12 = s11 + 1;
  const s13 = s12 + 1;
  const s14 = s13 + 1;
  const s15 = s14 + 1;
  const s16 = s15 + 1;
  const s17 = s16 + 1;
  const s18 = s17 + 1;
  const s19 = s18 + 1;
  const s20 = s19 + 1;
  const s21 = s20 + 1;
  const s22 = s21 + 1;
  const s23 = s22 + 1;
  const s24 = s23 + 1;
  const s25 = s24 + 1;
  return s25;
}

export { canaryDashboardFunctionOverCap };
