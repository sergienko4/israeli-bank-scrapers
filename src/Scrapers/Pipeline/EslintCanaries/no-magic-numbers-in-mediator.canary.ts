// Canary: §19.11 — `no-magic-numbers` ban on src/Scrapers/Pipeline/Mediator/**.
//
// The §19.11 rule (in eslint.config.mjs) forbids bare numeric literals
// outside the 0 / 1 / -1 escape hatch and array-index positions. Phase 2
// close-out — C12 — drained all 73 sites and introduced this canary so
// `verify.sh` can confirm the guardrail stays armed.
//
// This canary lives outside `src/Scrapers/Pipeline/Mediator/**`
// (it is in `EslintCanaries/` which is globally ignored at
// eslint.config.mjs:644) but is opted back in by the §19.11
// single-file block so `verify.sh` can fire the rule against the
// embedded `42` literal below.
//
// Do NOT replace `42` with a named constant — the canary's job is
// to be REJECTED by the rule.

/**
 * Padded helper used purely as an ESLint fixture for the §19.11
 * `no-magic-numbers` cap. The bare `42` below is the canary trigger.
 * @returns The literal 42 (irrelevant — value is unused).
 */
function canaryNoMagicNumberInMediator(): number {
  return 42;
}

/** Second named export — keeps `import-x/prefer-default-export` quiet. */
const CANARY_LABEL = '§19.11-no-magic-numbers-in-mediator' as const;

export { CANARY_LABEL, canaryNoMagicNumberInMediator };
