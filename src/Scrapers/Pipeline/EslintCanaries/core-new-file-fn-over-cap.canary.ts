/**
 * ESLint canary — core-new-file-fn-over-cap.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: per-function size guard for new Pipeline/Core files — asserts
// `max-lines-per-function: 10` (skipBlankLines + skipComments) fires under
// §19.3b (eslint.config.mjs), which pins those files past the §19.3 Core
// grandfather (15) to the canonical 10-LoC cap. The single padded function
// below stays exactly 11 effective lines so "npm run lint:canaries" confirms
// max-lines-per-function fires — its body must stay >10 non-blank,
// non-comment lines.

function canaryCoreNewFileFunctionOverCap(): number {
  const s1 = 1;
  const s2 = s1 + 1;
  const s3 = s2 + 1;
  const s4 = s3 + 1;
  const s5 = s4 + 1;
  const s6 = s5 + 1;
  const s7 = s6 + 1;
  const s8 = s7 + 1;
  return s8;
}

export { canaryCoreNewFileFunctionOverCap };
