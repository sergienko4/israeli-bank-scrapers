/**
 * ESLint canary — scrape-executor-fn-over-cap.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: Phase 12e per-function size guard — asserts
// `max-lines-per-function: 10` (skipBlankLines + skipComments) fires on
// the Strategy/Scrape/Executor/** drained sub-cluster + the
// ScrapeExecutor facade. §19.1a (eslint.config.mjs) tightens these files
// past the §19.1 Strategy grandfather (40) back to the canonical 10-LoC
// cap; the single padded function below stays exactly 11 effective lines so
// "npm run lint:canaries" confirms max-lines-per-function fires — its
// body must stay >10 non-blank, non-comment statements.

function canaryScrapeExecutorFunctionOverCap(): number {
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

export { canaryScrapeExecutorFunctionOverCap };
