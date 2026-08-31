/**
 * ESLint canary — duplicated test scaffolding (sonarjs S4144).
 *
 * Repeated `it()` blocks differing only in literal inputs should
 * collapse into a config array iteration. CodeRabbit flagged this
 * pattern in `LoginFormActionsBranches.test.ts`,
 * `LoginPhaseActionsBranches.test.ts`, and
 * `PipelineContextFactoryHeadless.test.ts` on PR #257. This file
 * deliberately defines two identical helpers so verify.sh confirms
 * the guardrail fires.
 *
 * <p>Bodies are padded to four statements on purpose. `sonarjs/no-identical-
 * functions` has a default `threshold` of 3 LINES of body, so the original
 * one-statement helpers sat under the bar and the rule never fired — the
 * canary passed for two years on incidental `jsdoc/require-returns` noise
 * instead. Do not shorten them.
 *
 * canary-expects-rule: sonarjs/no-identical-functions
 */

/** Helper A — first identical function. */
function helperA(): string {
  const prefix = 'shared';
  const suffix = 'logic';
  const joined = `${prefix} ${suffix}`;
  return joined;
}

/** Helper B — same body as helperA, deliberately duplicated. */
function helperB(): string {
  const prefix = 'shared';
  const suffix = 'logic';
  const joined = `${prefix} ${suffix}`;
  return joined;
}

export { helperA, helperB };
