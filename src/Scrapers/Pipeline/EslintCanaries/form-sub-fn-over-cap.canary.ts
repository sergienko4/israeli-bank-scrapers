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

export { canaryFormSubFunctionOverCap };
