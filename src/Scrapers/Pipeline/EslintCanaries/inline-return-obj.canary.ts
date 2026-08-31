/**
 * ESLint canary — hand-rolled Procedure literal.
 *
 * `succeed()` / `fail()` in `Types/Procedure.ts` are the single spelling of the
 * discriminated union; returning `{ success: … }` inline drifts from it.
 *
 * <p>Historical note: this file previously certified the selector
 * `ReturnStatement > ObjectExpression`, which was configured NOWHERE — the
 * canary passed on unrelated lint noise and proved nothing. The narrowed
 * `> Property[key.name="success"]` form was added to the Pipeline contract so
 * the canary now has a real target. Keep the `success` key.
 *
 * <p>All three spellings are certified here. The arrow and quoted-key forms
 * were added 2026-08 alongside the selector that catches them: a concise arrow
 * body has no `ReturnStatement`, and a quoted key has no `key.name`, so both
 * walked past the original selector. A guard that only sees the spelling its
 * author happened to use is evaded by accident, not by intent.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: hand-roll a Procedure
 */
function badReturn(): { success: boolean } {
  return { success: true };
}

/** Concise arrow body — no ReturnStatement for a selector to hang off. */
const badArrow = (): { success: boolean } => ({ success: true });

/**
 * Literal key — no `key.name`, so only the `[key.value="success"]` branch of
 * the selector can see it.
 *
 * Written computed rather than as `{ 'success': true }` because Prettier's
 * default `quoteProps: "as-needed"` rewrites that back to a bare identifier,
 * which would silently turn this into a copy of `badReturn` and leave the
 * quoted-key branch untested — the same never-matches failure this whole
 * fixture exists to catch. `// prettier-ignore` is not an option: it is banned
 * repo-wide (see no-prettier-ignore.canary.ts). A computed Literal key is the
 * same `Property > Literal` shape and Prettier leaves it alone.
 */
function badQuotedKey(): { success: boolean } {
  return { ['success']: true };
}

export { badArrow, badQuotedKey, badReturn };
