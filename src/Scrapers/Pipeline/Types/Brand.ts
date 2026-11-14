/**
 * Nominal-type utility for the Pipeline architecture.
 *
 * Branded types satisfy Rule #15 (no primitive returns) AND pass
 * SonarJS rule typescript:S6564 because the right-hand side is a
 * `TSIntersectionType`, not one of the keyword types in the rule's
 * trigger set. Source verification:
 * https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/S6564/rule.ts
 *
 * The shape mirrors the existing `ICursorFirstPageWire` brand in
 * `Mediator/Scrape/CursorPagination.ts` — the project already uses
 * the `__brand` field; this module formalises the pattern as a
 * reusable generic so every primitive return type can become
 * nominal in one line.
 *
 * Branded values are NOT assignable from raw primitives; callers
 * must mint a value via the matching `mint*` helper. The mint
 * helper is a zero-cost cast at runtime — the brand exists only
 * in the type system.
 */

/**
 * Brand utility — produces a nominal type from a primitive plus a
 * unique tag. The tag is a string literal that names the brand;
 * unique tags keep distinct brands non-interchangeable even when
 * they share the same primitive base.
 */
export type Brand<TBase, TTag extends string> = TBase & {
  readonly __brand: TTag;
};

/** Origin+pathname URL safe for logs (query string stripped). */
export type SafeUrlForLog = Brand<string, 'SafeUrlForLog'>;

/**
 * Mints a SafeUrlForLog from a string. The caller is responsible
 * for stripping the query string before minting; the mint helper
 * does NOT sanitise.
 * @param sanitised - Origin+pathname only, query and credentials
 * already removed.
 * @returns The same string typed as SafeUrlForLog.
 */
export function mintSafeUrlForLog(sanitised: string): SafeUrlForLog {
  return sanitised as SafeUrlForLog;
}
