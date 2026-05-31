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
 */

/** Helper A — first identical function. */
function helperA(): string {
  return 'shared logic';
}

/** Helper B — same body as helperA, deliberately duplicated. */
function helperB(): string {
  return 'shared logic';
}

export { helperA, helperB };
