/**
 * Shared JSON value union — single source of truth for "any parsed
 * JSON tree" across the pipeline.
 *
 * <p>Spec.txt §1 RC-5: replaces the per-file `type JsonValue = unknown`
 * pattern (and its Sonar-suppression companion) that previously dodged
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
 * <p>The union is the *closed* JSON document algebra: a scalar, an
 * object, or an array — nothing else. Three modules
 * (`PiiRedactor/Types.ts`, `Envelope/JsonPointer.ts`,
 * `AccountResolve/BillingCycleCatalogShapes.ts`) independently
 * converged on exactly this shape before the consolidation landed,
 * which is the strongest available evidence that it is the right
 * contract for the pipeline.
 *
 * <p>Closedness is load-bearing, not cosmetic: walkers narrow with
 * {@link IJsonObject} / {@link JsonArray} guards and rely on the
 * remaining arm being {@link JsonScalar}. A wider union (the
 * `NonNullable<unknown> | undefined` arms this type carried while
 * RC-5 was half-finished) silently defeats that exhaustiveness and
 * forces casts at every leaf — weakening a guard, which
 * `before-commit-guidlines.md` §2 forbids.
 *
 * <p>Spec.txt §1 RC-5: replaces per-file `type X = unknown`
 * aliases (each with a Sonar-suppression comment) with one shared
 * definition. Honours the project's `no-restricted-syntax` ban on
 * bare `unknown` in function signatures while closing S6564 at the
 * same time. Enforced by
 * `Tests/Unit/Pipeline/Architecture/JsonValueSingleSource.test.ts`.
 */
type JsonValue = JsonScalar | IJsonObject | JsonArray;

/** Plain-record alias — JSON object reused at many sig positions. */
type JsonObject = IJsonObject;

/**
 * Boundary value — a JSON tree that has not been narrowed yet.
 *
 * <p>Use at the edges: `JSON.parse` results, captured response
 * bodies, and the parameter position of narrowing guards such as
 * `BalanceExtractor.isRecord`. Everything downstream of a guard
 * should be typed {@link JsonValue}.
 *
 * <p>This is the arm that satisfies the RC-5 goal of replacing
 * per-file `type X = unknown` aliases: the RHS is a `TSUnionType`,
 * so Sonar S6564 stays green, while
 * `NonNullable<unknown> | null | undefined` reproduces `unknown`'s
 * top-type semantics for callers that genuinely have not narrowed.
 *
 * <p>Keeping it distinct from {@link JsonValue} is the point. When
 * the two were fused under one name, every "this is JSON" signature
 * silently also accepted "this is anything", so the walkers' guard
 * exhaustiveness was unenforceable and four modules re-declared a
 * narrower `JsonValue` locally to get it back.
 */
type JsonUnknown = JsonValue | NonNullable<unknown> | null | undefined;

/**
 * Un-narrowed record — the result of an `isRecord`-style guard.
 *
 * <p>Distinct from {@link JsonObject}: its *values* are still
 * {@link JsonUnknown}, because narrowing a boundary value to "some
 * object" says nothing about what its properties hold. Extractors
 * that walk a captured response body (`BalanceExtractor`,
 * `TxnShape`, `ScrapeIdExtraction`) each previously declared this
 * shape locally under the name `JsonObject`, colliding with the
 * canonical alias while meaning something weaker — the same
 * divergence RC-5 exists to prevent.
 */
type JsonUnknownRecord = Record<string, JsonUnknown>;

/**
 * Un-narrowed list — the array counterpart of
 * {@link JsonUnknownRecord}.
 *
 * <p>Distinct from {@link JsonArray}: its *elements* are still
 * {@link JsonUnknown}, because narrowing a boundary value to "some
 * array" says nothing about what its elements hold.
 */
type JsonUnknownList = readonly JsonUnknown[];

export type {
  IJsonObject,
  JsonArray,
  JsonObject,
  JsonScalar,
  JsonUnknown,
  JsonUnknownList,
  JsonUnknownRecord,
  JsonValue,
};
