/**
 * Deterministic type signatures for Juggler delta identity.
 *
 * An accepted delta in `browser-stack.json` binds to `src:<sig>|dst:<sig>`, so
 * an upstream type change at the same path re-opens review (STALE + NEW)
 * instead of riding on an old acceptance.
 *
 * - primitives by name; `Enum(<sorted JSON literals joined by |>)`, so the
 *   string `"true"` and the boolean `true` differ and a `|` inside a value
 *   stays inside its quotes;
 * - `Array(<sig>)`, `Nullable(<sig>)`, `Optional(<sig>)` (fields only), `Ref(<name>)`;
 * - an object is `{<sorted keys>}` at the top of a signature, `Object` when nested;
 * - a missing side is `absent`.
 */

/**
 * @typedef {import('./juggler-schema.d.mts').SchemaType} SchemaType
 * @typedef {import('./juggler-schema.d.mts').IField} IField
 * @typedef {Extract<SchemaType, { t: 'Object' }>} ObjectType
 * @typedef {Extract<SchemaType, { t: 'Enum' }>} EnumType
 * @typedef {Extract<SchemaType, { t: 'Array' }>} ArrayType
 * @typedef {Extract<SchemaType, { t: 'Nullable' }>} NullableType
 * @typedef {Extract<SchemaType, { t: 'Ref' }>} RefType
 * @typedef {(type: SchemaType, depth: number) => string} SigRule - Signature of one type kind.
 */

/** An enum value as a JSON literal: `"image/png"`, `true`. */
export const enumLiteral = (/** @type {string | boolean} */ value) => JSON.stringify(value);

/** Type kind → signature builder; any other kind signs as its own name. */
const SIG = Object.freeze({
  Object: (/** @type {ObjectType} */ type, /** @type {number} */ depth) =>
    depth > 0 ? 'Object' : `{${Object.keys(type.fields).sort().join(',')}}`,
  Enum: (/** @type {EnumType} */ type) => `Enum(${type.values.map(enumLiteral).sort().join('|')})`,
  Array: (/** @type {ArrayType} */ type, /** @type {number} */ depth) =>
    `Array(${sig(type.item, depth + 1)})`,
  Nullable: (/** @type {NullableType} */ type, /** @type {number} */ depth) =>
    `Nullable(${sig(type.inner, depth + 1)})`,
  Ref: (/** @type {RefType} */ type) => `Ref(${type.name})`,
});

/**
 * Signature of a normalized type.
 *
 * @param {SchemaType | undefined} type - Normalized type, or undefined for a missing side.
 * @param {number} [depth] - Nesting depth; objects below the top sign as `Object`.
 * @returns {string} Deterministic signature.
 */
export function sig(type, depth = 0) {
  if (type === undefined) return 'absent';
  return Object.hasOwn(SIG, type.t)
    ? /** @type {Readonly<Record<string, SigRule>>} */ (SIG)[type.t](type, depth)
    : type.t;
}

/**
 * Signature of an object field, wrapping optional fields in `Optional(…)`.
 *
 * @param {IField | undefined} field - `{optional, type}`, or undefined for a missing key.
 * @returns {string} Deterministic signature.
 */
export function fieldSig(field) {
  if (field === undefined) return 'absent';
  return field.optional ? `Optional(${sig(field.type, 1)})` : sig(field.type);
}

/** Signature of a whole params/payload field map (`MISSING-METHOD`, `MISSING-EVENT`). */
export const fieldsSig = (/** @type {ObjectType['fields']} */ fields) =>
  sig({ t: 'Object', fields });

/** The `src:<sig>|dst:<sig>` identity part of a delta. */
export const pairSig = (/** @type {string} */ src, /** @type {string} */ dst) =>
  `src:${src}|dst:${dst}`;
