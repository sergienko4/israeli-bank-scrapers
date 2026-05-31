// Canary: Phase 8.5b Section 12B per-function size guard — asserts
// `max-lines-per-function: 10` (skipBlankLines + skipComments) fires
// on the canonical-10 sub-folders of Mediator/Scrape (ScrapePhase/**,
// ScrapeReplay/**, FrozenScrapeAction.ts, UrlDateRange.ts). The
// single function below is padded above the 10-LoC ceiling but kept
// under the §12 baseline cap of 20 so the verify loop confirms §12B
// is an independent, active rule layer (not subsumed by §12).

function canaryCanonical10FunctionOverCap(): number {
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
  return s13;
}

export { canaryCanonical10FunctionOverCap };
