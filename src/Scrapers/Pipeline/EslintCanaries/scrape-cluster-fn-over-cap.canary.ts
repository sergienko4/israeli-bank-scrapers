// Canary: asserts the strict per-function cap of the §19.0 baseline —
// `max-lines-per-function: 10` (skipBlankLines + skipComments) — is
// live for the Mediator/Scrape cluster.
//
// This file is deliberately un-ignored in §19.0 (see the negated entry
// in that block's `ignores`), so it resolves through the exact same
// config object as the 65 production Scrape files. Every other canary
// is excluded from §19.0 by the directory-wide ignore, which would
// otherwise leave that baseline — the last-wins declaration for those
// 65 files, and the default that the §19.1-§19.3 grandfathers override
// elsewhere — with no canary coverage at all.
//
// The function below is sized at 12 effective lines, which is the
// discriminating range: it exceeds the §19.0 cap of 10 (so the rule
// fires today), but stays under the 15 that the surrounding Pipeline
// grandfather would supply if §19.0 were deleted or relaxed. A canary
// padded well past both caps would fire either way and prove nothing.
// It also holds statements at 10 so `max-statements` stays silent and
// `max-lines-per-function` is the sole rule under test.
//
// canary-expects-rule: max-lines-per-function

function canaryFunctionOverCap(): number {
  const s1 = 1;
  const s2 = s1 + 1;
  const s3 = s2 + 1;
  const s4 = s3 + 1;
  const s5 = s4 + 1;
  const s6 = s5 + 1;
  const s7 = s6 + 1;
  const s8 = s7 + 1;
  const s9 = s8 + 1;
  return s9;
}

export { canaryFunctionOverCap };
