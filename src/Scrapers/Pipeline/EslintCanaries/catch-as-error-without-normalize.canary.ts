// Canary: catch-clause `error as Error` cast — Pipeline code must use
// toErrorMessage(error) / toError(error) from `Types/ErrorUtils.ts`
// instead of asserting Error subclass via `as Error`. The cast is
// brittle because TypeScript's catch parameter is `unknown` (strict
// mode), so the assertion silently mislabels non-Error throws (null,
// undefined, primitives, plain objects, cross-realm Error, throwing
// toString).
//
// Selector: `CatchClause TSAsExpression > TSTypeReference > Identifier[name='Error']`
//
// Phase 2 close-out — C4 install. Phases C1-C3 widened toErrorMessage
// to accept unknown and drained all Bucket A/B/C call sites in
// src/Scrapers/ so this guardrail can fire on any regression without
// requiring a follow-up clean-up pass.
function brittleCatch(): string {
  try {
    JSON.parse('not-json');
  } catch (error) {
    return (error as Error).message;
  }
  return 'unreachable';
}

export { brittleCatch };
