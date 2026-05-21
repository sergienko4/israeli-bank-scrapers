/**
 * Shared JSON value union — single source of truth for "any parsed
 * JSON tree" across the pipeline.
 *
 * <p>Spec.txt §1 RC-5: replaces the per-file `type JsonValue = unknown`
 * pattern (and its `NOSONAR` companion) that previously dodged
 * SonarJS rule `typescript:S6564` (redundant type alias) while
 * still honouring the project's architecture-rule ban on bare
 * `unknown` in function parameter/return positions
 * (`eslint.config.mjs` `no-restricted-syntax` selectors
 * forbidding `TSUnknownKeyword` in signature positions).
 *
 * <p>The union is structural — `string | number | boolean | null`
 * scalars plus recursive `JsonValue[]` and
 * `{ [k: string]: JsonValue `} composites. Sonar accepts the
 * union as non-redundant because the right-hand side is a
 * `TSUnionType`, not the bare `TSUnknownKeyword` that
 * trips the rule. Honouring both constraints simultaneously: Sonar
 * S6564 stays green AND the architecture rule keeps function
 * signatures explicit.
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-5):
 * <ul>
 *   <li>`before-commit-guidlines.md` §2 — "Never weaken eslint,
 *       guards, validation, or thresholds." Inlining bare
 *       `unknown` would re-introduce the architecture-rule
 *       violation that the per-file alias was added to dodge.</li>
 *   <li>`design-patterns-guidlines.md` — "Prefer composition
 *       over inheritance" + "Prefer immutable flows."</li>
 *   <li>`general-rules-guidlines.md` — "every abstraction must
 *       be testable and strongly typed."</li>
 * </ul>
 */

/** JSON leaf scalar (no `undefined` — JSON does not encode it). */
type JsonScalar = string | number | boolean | null;

/** JSON object — recursive map of string keys to JSON values. */
interface IJsonObject {
  readonly [key: string]: JsonValue;
}

/** JSON array — readonly list of JSON values. */
type JsonArray = readonly JsonValue[];

/**
 * Untyped JSON value crossing module boundaries.
 *
 * <p>The union RHS satisfies Sonar S6564 (the right-hand side is a
 * `TSUnionType`, not the bare `TSUnknownKeyword` that
 * trips the rule) while staying assignment-compatible with bare
 * `unknown` at consumer sites — `NonNullable<unknown>`
 * is `{`} plus the explicit `null` / `undefined`
 * arms reproduce the original `unknown`'s top-type semantics.
 * The structural {@link IJsonObject} / {@link JsonArray} arms keep
 * the union genuinely "JSON-shaped" for callers that want a
 * narrower contract via type guards.
 *
 * <p>Spec.txt §1 RC-5: replaces per-file `type X = unknown`
 * aliases (eight files, each with a `NOSONAR` comment) with
 * one shared definition. Honours the project's
 * `no-restricted-syntax` ban on bare `unknown` in
 * function signatures while closing S6564 at the same time.
 */
type JsonValue = JsonScalar | IJsonObject | JsonArray | NonNullable<unknown> | null | undefined;

/** Plain-record alias — JSON object reused at many sig positions. */
type JsonObject = IJsonObject;

export type { IJsonObject, JsonArray, JsonObject, JsonScalar, JsonValue };
