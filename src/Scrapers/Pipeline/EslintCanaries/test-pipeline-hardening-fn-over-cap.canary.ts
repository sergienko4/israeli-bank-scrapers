/**
 * ESLint canary — test-pipeline-hardening-fn-over-cap.
 *
 * canary-expects-rule: phase9-local/fn-declaration-max-lines
 */

// Canary: §19.11 — Phase 10 wave 2 pipeline-hardening test cap.
//
// The §19.11 wave 2 block (eslint.config.mjs §19.11) re-arms the
// `phase9-local/fn-declaration-max-lines:10` rule on new pipeline-
// mirroring tests (PR #336 Seq #1 added 3 such files). The rule
// catches the slip-class CR cycle PR #336 #1 exposed: a 12-LoC
// `buildEndpoint` FunctionDeclaration that ESLint silently allowed
// because §7's broad `src/Tests/**` override turns the built-in
// `max-lines-per-function` OFF entirely (~3 049 arrow-callback
// violators across `src/Tests/**` would otherwise fire).
//
// Why duplicate the §19.10 canary? §19.10 + §19.11 use the SAME rule
// implementation but enforce DIFFERENT file globs. This wave-2 canary
// proves the rule remains armed on the wave-2 paths specifically —
// future glob trimming (e.g. moving a file out of
// PHASE_10_WAVE_2_PIPELINE_HARDENING_TESTS) cannot silently disarm
// the wave-2 enforcement without also dropping this canary.
//
// This canary lives outside `src/Tests/**` (it is in `EslintCanaries/`
// which is globally ignored at eslint.config.mjs line 539) but is
// opted back in by the §19.11-canary single-file block so `verify.sh`
// can confirm the guardrail stays armed.
//
// The function below spans exactly 11 LINES — one over the 10-line
// cap, the tightest size that still fires. Do NOT resize it in either
// direction: at 10 it stops firing, and at 12+ a commit could raise the
// cap to 11 and this canary would stay silent. `assert-numeric-canaries`
// enforces the exact size. Do NOT add suppression directives — the
// project's no-suppression rule (and the §19.11 contract) bars
// silencing this canary.

/**
 * Padded helper used purely as an ESLint fixture for the §19.11
 * Phase 10 wave 2 pipeline-hardening test cap. Breaches the
 * `phase9-local/fn-declaration-max-lines:10` rule at 11 lines.
 * @returns The sum (irrelevant — value is unused).
 */
function canaryPipelineHardeningFnOverCap(): number {
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

/** Second named export — keeps `import-x/prefer-default-export` quiet. */
const CANARY_LABEL_WAVE_2 = '§19.11-pipeline-hardening-fn-over-cap' as const;

export { CANARY_LABEL_WAVE_2, canaryPipelineHardeningFnOverCap };
