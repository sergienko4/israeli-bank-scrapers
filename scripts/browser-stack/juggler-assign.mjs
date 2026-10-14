/**
 * Directional assignability between two Juggler field maps or types
 * (`objectAssign` for field maps, `typeAssign` for types).
 *
 * The question is always "can every value `src` permits be consumed by
 * `dst`?". The cursor carries the channel: `request` is strict (the browser's
 * `checkScheme` rejects unknown keys), `return` and `event` are lenient (the
 * playwright-core client validates nothing, so extra browser keys are
 * harmless). Each finding is pushed to `cursor.out` as
 * `{channel, kind, path, signature}`.
 *
 * `objectAssign` and `typeAssign` recurse into each other, so they share this
 * module (no import cycle). The top level lives in `juggler-diff.mjs`.
 */
import { enumLiteral, fieldSig, pairSig, sig } from './juggler-sig.mjs';

/**
 * @typedef {import('./juggler-schema.d.mts').SchemaType} SchemaType
 * @typedef {import('./juggler-schema.d.mts').IField} IField
 * @typedef {import('./juggler-schema.d.mts').NormalizedSchema['namespaces']} Namespaces
 * @typedef {import('./juggler-diff.d.mts').IJugglerDelta} IJugglerDelta
 * @typedef {Readonly<Record<string, IField>>} Fields - One field map.
 * @typedef {Extract<SchemaType, { t: 'Object' }>} ObjectType
 * @typedef {Extract<SchemaType, { t: 'Array' }>} ArrayType
 * @typedef {Extract<SchemaType, { t: 'Enum' }>} EnumType
 */

/**
 * @typedef {object} Cursor
 * @property {import('./juggler-diff.d.mts').DeltaChannel} channel - `request` | `return` |
 *   `event`.
 * @property {string} path - Delta path so far, e.g. `Browser.newPage.browserContextId`.
 * @property {IJugglerDelta[]} out - Collected deltas.
 * @property {ReadonlySet<string>} seen - Ref pairs already on this path (cycle guard).
 * @property {Namespaces} srcTypes - Namespaces of the `src` schema, for Ref resolution.
 * @property {Namespaces} dstTypes - Namespaces of the `dst` schema, for Ref resolution.
 */

/** Channels where a key unknown to `dst` is rejected. */
const STRICT = new Set(['request']);

/**
 * Own property or undefined — field names such as `constructor` stay data.
 *
 * @template T
 * @param {Readonly<Record<string, T>>} obj - Map to read.
 * @param {string} key - Property name.
 * @returns {T | undefined} The own value, else undefined.
 */
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

/** Cursor moved to another path. */
const at = (/** @type {Cursor} */ cur, /** @type {string} */ path) => ({ ...cur, path });

/** Record one delta at the cursor's path. */
function push(
  /** @type {Cursor} */ cur,
  /** @type {import('./juggler-diff.d.mts').JugglerDeltaKind} */ kind,
  /** @type {string} */ signature,
) {
  cur.out.push({ channel: cur.channel, kind, path: cur.path, signature });
}

/**
 * Compare two field maps over the union of their keys.
 *
 * @param {Fields} src - Fields of the producing side.
 * @param {Fields} dst - Fields of the consuming side.
 * @param {Cursor} cur - Channel, path and output.
 * @returns {void}
 */
export function objectAssign(src, dst, cur) {
  const keys = [...new Set([...Object.keys(src), ...Object.keys(dst)])].sort();
  for (const key of keys) fieldAssign(own(src, key), own(dst, key), at(cur, `${cur.path}.${key}`));
}

/** One key of `objectAssign`: presence and optionality, then the types. */
function fieldAssign(
  /** @type {IField | undefined} */ s,
  /** @type {IField | undefined} */ d,
  /** @type {Cursor} */ cur,
) {
  if (d === undefined) {
    if (STRICT.has(cur.channel)) push(cur, 'UNKNOWN-FIELD', pairSig(fieldSig(s), 'absent'));
    return;
  }
  const required = !d.optional && (s === undefined || s.optional);
  if (required) push(cur, 'MISSING-REQUIRED-FIELD', pairSig(fieldSig(s), fieldSig(d)));
  if (s !== undefined) typeAssign(s.type, d.type, cur);
}

/** The type inside one `Nullable`, else the type itself. */
const unwrap = (/** @type {SchemaType} */ type) => (type.t === 'Nullable' ? type.inner : type);

/**
 * Compare two types.
 *
 * @param {SchemaType} s - Producing type.
 * @param {SchemaType} d - Consuming type.
 * @param {Cursor} cur - Channel, path and output.
 * @returns {void}
 */
export function typeAssign(s, d, cur) {
  if (d.t === 'Any') return;
  const lostNull = s.t === 'Nullable' && d.t !== 'Nullable';
  const [su, du] = [unwrap(s), unwrap(d)];
  if (su.t === 'Ref' || du.t === 'Ref') return refAssign({ su, du, lostNull }, cur);
  if (lostNull) push(cur, 'NULLABLE', pairSig(sig(su), sig(du)));
  if (du.t !== 'Any') shapeAssign(su, du, cur);
}

/** A Ref resolved in the namespaces of the schema it came from. */
function resolve(/** @type {SchemaType} */ type, /** @type {Namespaces} */ types) {
  return type.t === 'Ref' ? types[type.ns][type.name] : type;
}

/**
 * Unwrapped types of a `typeAssign` step, and whether `src` dropped a `Nullable` `dst` lacks.
 *
 * @typedef {{ su: SchemaType, du: SchemaType, lostNull: boolean }} RefPair
 */

/** Step 3: resolve Refs once per (channel, src, dst) pair on the current path. */
function refAssign(/** @type {RefPair} */ pair, /** @type {Cursor} */ cur) {
  const key = `${cur.channel}:${sig(pair.su)}>${sig(pair.du)}`;
  if (cur.seen.has(key)) return;
  const next = { ...cur, seen: new Set(cur.seen).add(key) };
  const rs = resolve(pair.su, cur.srcTypes);
  /** @type {SchemaType} */
  const src = pair.lostNull ? { t: 'Nullable', inner: rs } : rs;
  typeAssign(src, resolve(pair.du, cur.dstTypes), next);
}

/** Step 5: every `src` enum value the `dst` enum lacks. */
function enumAssign(
  /** @type {EnumType} */ s,
  /** @type {EnumType} */ d,
  /** @type {Cursor} */ cur,
) {
  const signature = pairSig(sig(s), sig(d));
  const extra = s.values.filter(
    (/** @type {string | boolean} */ value) => !d.values.includes(value),
  );
  for (const value of extra)
    push(at(cur, `${cur.path}=${enumLiteral(value)}`), 'ENUM-VALUE', signature);
}

/** `<src kind>><dst kind>` → comparison; unlisted pairs match only on equal kinds. */
const SHAPES = Object.freeze({
  'Object>Object': (
    /** @type {ObjectType} */ s,
    /** @type {ObjectType} */ d,
    /** @type {Cursor} */ cur,
  ) => objectAssign(s.fields, d.fields, cur),
  'Array>Array': (
    /** @type {ArrayType} */ s,
    /** @type {ArrayType} */ d,
    /** @type {Cursor} */ cur,
  ) => typeAssign(s.item, d.item, at(cur, `${cur.path}[]`)),
  'Enum>Enum': enumAssign,
  'Enum>String': () => undefined,
});

/**
 * One `SHAPES` comparison; its `<src kind>><dst kind>` key fixes both kinds.
 *
 * @typedef {(s: SchemaType, d: SchemaType, cur: Cursor) => void} ShapeRule
 */

/** Steps 4–6 on unwrapped, resolved types. */
function shapeAssign(
  /** @type {SchemaType} */ s,
  /** @type {SchemaType} */ d,
  /** @type {Cursor} */ cur,
) {
  const rule = own(SHAPES, `${s.t}>${d.t}`);
  if (rule !== undefined) return /** @type {ShapeRule} */ (rule)(s, d, cur);
  if (s.t !== d.t) push(cur, 'TYPE-MISMATCH', pairSig(sig(s), sig(d)));
}
