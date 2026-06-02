// Canary: Phase 2b lockdown per-function size guard — asserts
// `max-lines-per-function: 10` fires on Mediator/Api/, Mediator/
// ApiDirectCall/ and Mediator/Selector/ sub-modules. Phase 2b
// extracted 74 over-cap functions across 15 files in these three
// clusters down to ≤10 LoC bodies (commit `3533ed97`); this canary
// + the eslint.config.mjs override block guarantees no regression
// can reintroduce a > 10-LoC function in any of the three clusters.
// The single function below is padded above the 10 skipBlankLines +
// skipComments ceiling so verify.sh confirms the rule fires.

function canaryApiSelectorFunctionOverCap(): number {
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

export { canaryApiSelectorFunctionOverCap };
