/**
 * ESLint canary — types-domain-fn-over-10.
 *
 * canary-expects-rule: max-lines-per-function
 */

// Canary: Phase 8.5c / Commit C2 + C6 — §7b Types/Domain per-fn
// ≤10-LoC cap guard.
//
// Phase 8.5c / Commit C2 extended the §7b
// (`Types/Domain/**`) block with `max-lines-per-function: 10`
// so type-only domain modules are measured by the same yardstick
// as production modules. The folder is dominated by
// zero-LoC interface / type declarations; helpers and any future
// runtime code MUST fit within the canonical ≤10-LoC ceiling.
//
// This canary lives at `EslintCanaries/` (not under
// `Types/Domain/`) but is added to §7b's `files: [...]` array in
// `eslint.config.mjs` so it inherits the cap and triggers it.
// The single function below is padded to 11 effective LoC so
// `max-lines-per-function` fires; verify.sh requires a real
// rule-ID hit (Parsing-error pass is rejected post Phase 8.5c
// T1).

function canaryTypesDomainFunctionOverTen(): number {
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

export { canaryTypesDomainFunctionOverTen };
