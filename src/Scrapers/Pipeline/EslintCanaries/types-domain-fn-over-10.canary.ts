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
  const a = 1;
  const b = a + 1;
  const c = b + 1;
  const d = c + 1;
  const e = d + 1;
  const f = e + 1;
  const g = f + 1;
  const h = g + 1;
  const i = h + 1;
  const j = i + 1;
  const k = j + 1;
  return k;
}

export { canaryTypesDomainFunctionOverTen };
