/**
 * Deterministic type signatures for Juggler delta identity.
 *
 * An accepted delta in `browser-stack.json` binds to `src:<sig>|dst:<sig>`, so
 * an upstream type change at the same path re-opens review (STALE + NEW)
 * instead of riding on an old acceptance.
 *
 * - primitives by name; `Enum(<sorted values joined by |>)`;
 * - `Array(<sig>)`, `Nullable(<sig>)`, `Optional(<sig>)` (fields only), `Ref(<name>)`;
 * - an object is `{<sorted keys>}` at the top of a signature, `Object` when nested;
 * - a missing side is `absent`.
 */

/** Type kind → signature builder; any other kind signs as its own name. */
const SIG = Object.freeze({
  Object: (/** @type {any} */ type, /** @type {number} */ depth) =>
    depth > 0 ? 'Object' : `{${Object.keys(type.fields).sort().join(',')}}`,
  Enum: (/** @type {any} */ type) => `Enum(${type.values.map(String).sort().join('|')})`,
  Array: (/** @type {any} */ type, /** @type {number} */ depth) =>
    `Array(${sig(type.item, depth + 1)})`,
  Nullable: (/** @type {any} */ type, /** @type {number} */ depth) =>
    `Nullable(${sig(type.inner, depth + 1)})`,
  Ref: (/** @type {any} */ type) => `Ref(${type.name})`,
});

/**
 * Signature of a normalized type.
 *
 * @param {any} type - Normalized type, or undefined for a missing side.
 * @param {number} [depth] - Nesting depth; objects below the top sign as `Object`.
 * @returns {string} Deterministic signature.
 */
export function sig(type, depth = 0) {
  if (type === undefined) return 'absent';
  return Object.hasOwn(SIG, type.t) ? SIG[type.t](type, depth) : type.t;
}

/**
 * Signature of an object field, wrapping optional fields in `Optional(…)`.
 *
 * @param {any} field - `{optional, type}`, or undefined for a missing key.
 * @returns {string} Deterministic signature.
 */
export function fieldSig(field) {
  if (field === undefined) return 'absent';
  return field.optional ? `Optional(${sig(field.type, 1)})` : sig(field.type);
}

/** Signature of a whole params/payload field map (`MISSING-METHOD`, `MISSING-EVENT`). */
export const fieldsSig = (/** @type {object} */ fields) => sig({ t: 'Object', fields });

/** The `src:<sig>|dst:<sig>` identity part of a delta. */
export const pairSig = (/** @type {string} */ src, /** @type {string} */ dst) =>
  `src:${src}|dst:${dst}`;
