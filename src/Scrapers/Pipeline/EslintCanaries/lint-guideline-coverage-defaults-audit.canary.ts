// Canary: Phase 8.5c / Commit C5 + C6 — lint-guideline-coverage
// tool default-set drift guard.
//
// Commit C5 extended `src/Tests/Tools/lint-guideline-coverage.ts`
// from 5 to 7 cluster expectations (added §3 Main Source Strict
// + §6 Pipeline Logic, both flagged `pendingPhase2: true`). The
// tool drives `ESLint.calculateConfigForFile` against a
// representative file per cluster and asserts the resolved rule
// set matches the canonical CLEAN_CODE.md caps.
//
// This canary defends the cluster-cap invariant from the OTHER
// direction: it sits inside the §13 PiiRedactor cluster scope
// (added via `eslint.config.mjs` §13 `files: [...]`) with a
// 12-LoC function that exceeds the ≤10 cap. If a future commit
// relaxes §13's `max-lines-per-function` rule (i.e. lifts the
// canonical default that the coverage tool asserts at gate
// time), THIS canary would stop firing AND the coverage gate
// would simultaneously flag the mismatch — providing a
// double-defence against silent default drift.
//
// Sibling guarantees:
//   • `pii-cluster-fn-over-cap.canary.ts` — 25-LoC, broad margin.
//   • `pii-facade-no-grandfather.canary.ts` — 15-LoC, threshold
//      that used to be admissible under §13A.
//   • THIS canary — 12-LoC, tightest margin above the cap.

function canaryLintGuidelineCoverageDefaultsAudit(): number {
  const p1 = 1;
  const p2 = p1 + 1;
  const p3 = p2 + 1;
  const p4 = p3 + 1;
  const p5 = p4 + 1;
  const p6 = p5 + 1;
  const p7 = p6 + 1;
  const p8 = p7 + 1;
  const p9 = p8 + 1;
  const p10 = p9 + 1;
  const p11 = p10 + 1;
  const p12 = p11 + 1;
  return p12;
}

export { canaryLintGuidelineCoverageDefaultsAudit };
