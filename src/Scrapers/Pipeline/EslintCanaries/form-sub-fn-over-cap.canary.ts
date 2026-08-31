/**
 * ESLint canary — form-sub-fn-over-cap.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: Phase 12d lockdown per-function size guard — asserts the
// §19.4a three-rule lock (`max-statements: 10` +
// `max-lines-per-function: 10` with skipBlankLines+skipComments+
// IIFEs:true) fires on the three NEW Form sub-folders:
// `Mediator/Form/Actions/`, `Mediator/Form/Anchor/`, and
// `Mediator/Form/ErrorDiscovery/`. Phase 12d extracted 16 over-cap
// functions across those folders down to ≤10 statement/LoC bodies;
// this canary + the eslint.config.mjs §19.4a override block
// guarantees no regression can reintroduce a >10-statement /
// >10-LoC function in any of the three Form sub-clusters.
//
// SIZED DELIBERATELY — 13 effective lines, not 28. At 28 the body
// broke the fallback Pipeline cap of 15 as well as the §19.4a cap of
// 10, so the canary stayed red even with the §19.4a override deleted:
// it certified "some cap exists", not "the cap is 10". Kept just over
// 10 and comfortably under 15, only a cap of ≤12 can flag it, so
// losing the override turns this file green and the ratchet red.
// Do not pad this function.

function canaryFormSubFunctionOverCap(): number {
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
  return s10;
}

export { canaryFormSubFunctionOverCap };
