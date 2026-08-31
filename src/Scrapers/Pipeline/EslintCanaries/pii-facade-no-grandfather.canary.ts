/**
 * ESLint canary — pii-facade-no-grandfather.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: Phase 8.5c / Commit C2 + C6 — §13A grandfather drain
// guard.
//
// Before Phase 8.5c the §13A override (now removed) granted
// `PiiRedactor/Facade.ts` a 20-LoC per-function ceiling because
// the legacy `redact()` composer + helpers sat 15-19 LoC each.
// Phase 8.5c / Commit C1 split Facade.ts into Routing.ts +
// Dispatch.ts + a 61-LoC Facade.ts composer; Commit C2 deleted
// §13A entirely so the canonical §13 ≤10-LoC cap now applies to
// every file in `Types/PiiRedactor/**`.
//
// This canary is sized to **exactly 11 effective LoC** — one over the
// canonical ≤10 cap, the tightest size that still fires. Any relaxation
// of the cap, whether a one-step raise to 11 or a full re-introduction
// of the §13A 20-LoC grandfather, stops `max-lines-per-function` firing
// here and verify.sh flags this canary as "Guardrails inactive".
// `assert-numeric-canaries.cjs` enforces the exact size; an earlier
// revision sat at 15 LoC and so could not detect a raise to 11-15.
//
// Sibling canary: `pii-cluster-fn-over-cap.canary.ts` proves the same
// cap fires in the broader `Types/PiiRedactor/**` cluster.

function canaryPiiFacadeNoGrandfather(): number {
  const v1 = 1;
  const v2 = v1 + 1;
  const v3 = v2 + 1;
  const v4 = v3 + 1;
  const v5 = v4 + 1;
  const v6 = v5 + 1;
  const v7 = v6 + 1;
  const v8 = v7 + 1;
  return v8;
}

export { canaryPiiFacadeNoGrandfather };
