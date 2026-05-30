// Canary: Phase 6 §13 per-function size guard — asserts
// `max-lines-per-function: 10` (skipBlankLines + skipComments +
// IIFEs) fires on the PiiRedactor cluster. The single function
// below is padded above the 10 effective-line ceiling so
// verify.sh confirms the rule fires.
//
// Background: CR cycle-1 #7 caught Url.ts `redactUrl` at ~10-12
// LoC, but the §6C default cap was 15 — so the violation slipped
// past pre-commit. §13 tightens to 10 (matching CLAUDE.md
// "Max 10 lines per method"), and this canary keeps the rule alive.

function canaryPiiFunctionOverCap(): number {
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
  return s12;
}

export { canaryPiiFunctionOverCap };
