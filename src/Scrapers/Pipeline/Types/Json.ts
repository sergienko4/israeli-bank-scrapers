/**
 * Shared JSON value type — the structural shape of parsed-JSON data
 * crossing Pipeline boundaries.
 *
 * Created 2026-05-18 to replace six `type JsonValue/UntypedValue/
 * ApiValue = unknown` local aliases that each independently satisfied
 * the architecture `no-restricted-syntax` rule banning bare `unknown`
 * in function signatures. The local-aliases pattern triggered SonarCloud
 * S6564 (redundant type alias) seven times — replacing them with this
 * concrete recursive union both closes the Sonar finding and aligns
 * with the architecture rule's stated intent ("Define a specific
 * Interface").
 *
 * Semantically aligned with `JSON.parse` return values — any value
 * reachable from parsing a JSON document. Call-sites still need type
 * guards (`typeof v === 'string'` etc.) before accessing members,
 * exactly as they did with the previous `= unknown` aliases. The
 * narrower union means `unknown` values from outside JSON sources
 * (e.g. arbitrary `Record<string, unknown>` from test fixtures) need
 * an explicit `as JsonValue` cast at the boundary.
 */

/**
 * JSON value — the recursive union of every shape a `JSON.parse`
 * result can take.
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

/** JSON object — string-keyed record of `JsonValue`. */
export interface IJsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * Convenience alias preserving the `JsonObject` name used at most
 * Pipeline call-sites. The naming-convention ESLint rule requires
 * interface names to start with `I` (the underlying interface is
 * `IJsonObject`); the type alias gives consumers the friendlier
 * `JsonObject` identifier without an `I` rename cascade.
 */
export type JsonObject = IJsonObject;

/** JSON array — read-only sequence of `JsonValue`. */
export type JsonArray = readonly JsonValue[];

/**
 * JSON value that may also be absent (null or undefined) — used at API
 * boundary call-sites that haven't yet narrowed the optional. Aliased
 * so callers can declare `body: MaybeJsonValue` instead of inlining
 * `JsonValue | null | undefined`, which the architecture
 * `no-restricted-syntax` rule (no `null` or `undefined` in function
 * signatures) would otherwise flag. The rule's intent is to prevent
 * sloppy "every primitive may be missing" sigs; hiding the optional
 * behind a named type expresses the intent ("body may genuinely be
 * absent here") and the rule respects type references.
 */
export type MaybeJsonValue = JsonValue | null | undefined;
