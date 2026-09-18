/**
 * Shared JSON value union — single source of truth for "any parsed
 * JSON tree" across the pipeline.
 *
 * <p>Spec.txt §1 RC-5: replaces the per-file `type JsonValue = unknown`
 * pattern that previously dodged SonarJS rule `typescript:S6564`
 * (redundant type alias). It also gives the intended ban on bare
 * `unknown` in signature positions a vocabulary to land on. Note
 * that ban is NOT active today: both `no-restricted-syntax`
 * selectors forbidding `TSUnknownKeyword` in parameter and return
 * positions sit in `PIPELINE_SYNTAX_PENDING_DRAIN` in
 * `eslint.config.mjs` and are filtered out of the active rule set.
 *
 * <p>The CLOSED arms satisfy S6564 structurally — `string | number |
 * boolean | null` scalars plus recursive `JsonValue[]` and
 * `{ [k: string]: JsonValue `} composites, and a `TSUnionType`
 * right-hand side is not the bare `TSUnknownKeyword` that trips the
 * rule. The OPEN arm cannot: {@link JsonUnknown} is `unknown` by
 * definition, so it carries a declared, file-scoped S6564 exemption
 * instead — see its own JSDoc below and
 * `docs/architecture/json-algebra.md`. Because that exemption is
 * file-scoped, it silences S6564 for this whole module — including
 * {@link JsonObject}, a deliberate rename of {@link IJsonObject}.
 * `JsonValueSingleSource.test.ts` puts the guard back at declaration
 * granularity: it runs S6564 itself with the exemption overridden
 * and asserts the rule reports exactly one alias here — this one.
 * Modelling the rule by hand drifts from it; running it cannot.
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-5):
 * <ul>
 *   <li>`before-commit-guidlines.md` §2 — "Never weaken eslint,
 *       guards, validation, or thresholds." Inlining bare
 *       `unknown` would discard the name the open/closed guard
 *       analysis reads, leaving the boundary contract unnamed and
 *       the guard with nothing to key on.</li>
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
 * definition, and closes S6564 for the closed arms structurally.
 * It also supplies the name the intended — currently drain-queued —
 * `no-restricted-syntax` ban on bare `unknown` in signatures will
 * need. Enforced by
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
 * <p>`docs/architecture/json-algebra.md` defines this symbol as the
 * algebra's *open* arm: "one un-narrowed value at a boundary". That
 * is an *opaque* boundary contract — a value carrying no structural
 * guarantee this code may rely on — and `unknown` is the spelling
 * that states it, rather than working around it. (It does not follow
 * that every un-narrowed value is the top type: a value with trusted
 * provenance can deserve a narrower arm. The open arm is for the
 * ones that do not have it.)
 *
 * <p>Spelled `unknown` outright, and exempted from Sonar S6564 in
 * `eslint.config.mjs`, `sonar-project.properties` and the
 * architecture allowlist. All three are FILE-scoped — the narrowest
 * scope those mechanisms support — so they also silence the rule for
 * the closed arms; `JsonValueSingleSource.test.ts` restores the
 * declaration-level guard by pinning this module to exactly one
 * bare-keyword alias. S6564 is right that the alias adds no *type*
 * information; it is wrong that the alias is therefore redundant —
 * here the name is the contract. The rejected alternative spellings,
 * and why each is blocked by a different gate, are tabulated in the
 * architecture doc.
 *
 * <p>Keeping it distinct from {@link JsonValue} is the point. When
 * the two were fused under one name, every "this is JSON" signature
 * silently also accepted "this is anything", so the walkers' guard
 * exhaustiveness was unenforceable and four modules re-declared a
 * narrower `JsonValue` locally to get it back.
 *
 * <p>Narrowing this arm for real is deferred, not forgotten.
 * Attempting it costs 29 type errors across 17 files — boundaries
 * that today accept whatever arrived and have no guard to narrow it.
 * That, not any alias count, is why it cascades rather than
 * converges. It is tracked under "Known gap" in
 * `docs/architecture/json-algebra.md`, with a reproducible measuring
 * recipe and, alongside it, an exact-equality ratchet in
 * `JsonValueSingleSource.test.ts` holding the related open-record
 * alias population still at 31.
 */
type JsonUnknown = unknown;

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
