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
// This canary is sized to **15 effective LoC** — the EXACT
// threshold that USED to be admissible under §13A but is now
// caught by §13's ≤10 cap. The size differential gives the
// canary its semantic value: if a future commit re-introduces
// the §13A grandfather (or otherwise relaxes the cap above 10),
// `max-lines-per-function` would stop firing here and verify.sh
// would flag this canary as "Guardrails inactive".
//
// Sibling canary: `pii-cluster-fn-over-cap.canary.ts` proves
// the same cap fires on a 25-LoC function (broader margin); this
// canary specifically guards the legacy escape threshold.

function canaryPiiFacadeNoGrandfather(): number {
  const v1 = 1;
  const v2 = v1 + 1;
  const v3 = v2 + 1;
  const v4 = v3 + 1;
  const v5 = v4 + 1;
  const v6 = v5 + 1;
  const v7 = v6 + 1;
  const v8 = v7 + 1;
  const v9 = v8 + 1;
  const v10 = v9 + 1;
  const v11 = v10 + 1;
  const v12 = v11 + 1;
  const v13 = v12 + 1;
  const v14 = v13 + 1;
  const v15 = v14 + 1;
  return v15;
}

export { canaryPiiFacadeNoGrandfather };
