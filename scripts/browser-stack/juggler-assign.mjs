/**
 * Directional assignability between two Juggler field maps (`objectAssign`).
 *
 * The question is always "can every value `src` permits be consumed by
 * `dst`?". The cursor carries the channel: `request` is strict (the browser's
 * `checkScheme` rejects unknown keys), `return` and `event` are lenient (the
 * playwright-core client validates nothing, so extra browser keys are
 * harmless). Each finding is pushed to `cursor.out` as
 * `{channel, kind, path, signature}`. A key `dst` requires is missing when
 * `src` may leave it out, unless `dst` takes `undefined` there too.
 *
 * Named types nest as deep as a schema chains them, so the walk keeps its own
 * stack instead of the call stack: a field, an Array item or a resolved Ref
 * is scheduled, not called, and the last one scheduled runs first, so deltas
 * come out depth-first in key order. The top level lives in `juggler-diff.mjs`.
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
 * @property {Namespaces} srcTypes - Namespaces of the `src` schema, for Ref resolution.
 * @property {Namespaces} dstTypes - Namespaces of the `dst` schema, for Ref resolution.
 */

/**
 * A cursor inside one `objectAssign` walk.
 *
 * @typedef {object} WalkState
 * @property {(() => void)[]} todo - Steps still to run; the last one runs next.
 * @property {Set<string>} seen - Ref pairs on the current path (cycle guard): a pair
 *   joins when the walk enters it and leaves once its subtree is done.
 * @typedef {Cursor & WalkState} Walk
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

/**
 * Cursor moved to another path.
 *
 * @template {Cursor} C
 * @param {C} cur - Cursor to move.
 * @param {string} path - New path.
 * @returns {C} The cursor at `path`.
 */
const at = (cur, path) => ({ ...cur, path });

/** Record one delta at the cursor's path. */
function push(
  /** @type {Cursor} */ cur,
  /** @type {import('./juggler-diff.d.mts').JugglerDeltaKind} */ kind,
  /** @type {string} */ signature,
) {
  cur.out.push({ channel: cur.channel, kind, path: cur.path, signature });
}

/**
 * Compare two field maps over the union of their keys, to the end of every
 * type they reach.
 *
 * @param {Fields} src - Fields of the producing side.
 * @param {Fields} dst - Fields of the consuming side.
 * @param {Cursor} cur - Channel, path and output.
 * @returns {void}
 */
export function objectAssign(src, dst, cur) {
  /** @type {Walk} */
  const walk = { ...cur, todo: [], seen: new Set() };
  fieldsLater(src, dst, walk);
  for (let step = walk.todo.pop(); step !== undefined; step = walk.todo.pop()) step();
}

/** Schedule every key of two field maps, so they run in sorted order. */
function fieldsLater(
  /** @type {Fields} */ src,
  /** @type {Fields} */ dst,
  /** @type {Walk} */ cur,
) {
  const keys = [...new Set([...Object.keys(src), ...Object.keys(dst)])].sort().reverse();
  for (const key of keys) {
    const next = at(cur, `${cur.path}.${key}`);
    cur.todo.push(() => fieldAssign(own(src, key), own(dst, key), next));
  }
}

/** One key of a field map: presence and optionality, then the types. */
function fieldAssign(
  /** @type {IField | undefined} */ s,
  /** @type {IField | undefined} */ d,
  /** @type {Walk} */ cur,
) {
  if (d === undefined) {
    if (STRICT.has(cur.channel)) push(cur, 'UNKNOWN-FIELD', pairSig(fieldSig(s), 'absent'));
    return;
  }
  const mayOmit = s === undefined || s.optional;
  if (mayOmit && !omittable(d, cur.dstTypes))
    push(cur, 'MISSING-REQUIRED-FIELD', pairSig(fieldSig(s), fieldSig(d)));
  if (s !== undefined) typeAssign(s.type, d.type, cur);
}

/**
 * Whether a key may be left out, as Juggler's `checkScheme` decides it: an
 * absent key is checked as `undefined`, which `t.Optional` and `t.Any`
 * take, and `t.Nullable` and a Ref take when what they wrap does. So the
 * Nullable and Ref layers are peeled in a loop, in the namespaces of the
 * field's own schema; the parser rejects a Ref that only renames itself.
 *
 * @param {IField} field - The consuming field.
 * @param {Namespaces} types - Namespaces of the schema the field came from.
 * @returns {boolean} True when `undefined` passes the field's check.
 */
function omittable(field, types) {
  if (field.optional) return true;
  let type = unwrap(field.type);
  while (type.t === 'Ref') type = unwrap(types[type.ns][type.name]);
  return type.t === 'Any';
}

/**
 * The type inside every `Nullable` layer, else the type itself: a Nullable
 * nested in a Nullable admits the same values as one.
 *
 * @param {SchemaType} type - A type, maybe wrapped in `Nullable`.
 * @returns {SchemaType} The type with no `Nullable` on top.
 */
function unwrap(type) {
  return type.t === 'Nullable' ? unwrap(type.inner) : type;
}

/**
 * Compare two types; what they nest is scheduled on the walk.
 *
 * @param {SchemaType} s - Producing type.
 * @param {SchemaType} d - Consuming type.
 * @param {Walk} cur - Channel, path, output and the walk's stack.
 * @returns {void}
 */
function typeAssign(s, d, cur) {
  if (d.t === 'Any') return;
  const [su, du] = [unwrap(s), unwrap(d)];
  if (su.t === 'Ref' || du.t === 'Ref') return refAssign(s, d, cur);
  if (s.t === 'Nullable' && d.t !== 'Nullable') push(cur, 'NULLABLE', pairSig(sig(su), sig(du)));
  if (du.t !== 'Any') shapeAssign(su, du, cur);
}

/** A type made Nullable: exactly one layer, however many it had. */
function nullable(/** @type {SchemaType} */ type) {
  /** @type {SchemaType} */
  const wrapped = { t: 'Nullable', inner: unwrap(type) };
  return wrapped;
}

/**
 * A type with its Ref resolved in the namespaces of the schema it came from,
 * keeping its own `Nullable`: a Ref to a Nullable type stays one Nullable.
 *
 * @param {SchemaType} type - A type, maybe a Ref, maybe wrapped in `Nullable`.
 * @param {Namespaces} types - Namespaces of the schema the type came from.
 * @returns {SchemaType} The resolved type.
 */
function resolve(type, types) {
  const inner = unwrap(type);
  const target = inner.t === 'Ref' ? types[inner.ns][inner.name] : inner;
  return type.t === 'Nullable' ? nullable(target) : target;
}

/**
 * Step 3: resolve Refs once per (src, dst) pair on the current path. The pair
 * is keyed whole, Nullable and inline field types included, since `sig`
 * folds those away; a Ref keys by its name, so the keys stay finite. The
 * pair leaves `seen` only after everything scheduled above its leave step.
 */
function refAssign(
  /** @type {SchemaType} */ s,
  /** @type {SchemaType} */ d,
  /** @type {Walk} */ cur,
) {
  const key = JSON.stringify([s, d]);
  if (cur.seen.has(key)) return;
  cur.seen.add(key);
  cur.todo.push(() => cur.seen.delete(key));
  cur.todo.push(() => typeAssign(resolve(s, cur.srcTypes), resolve(d, cur.dstTypes), cur));
}

/** Both values a Boolean admits. */
const BOOLEANS = Object.freeze([false, true]);

/**
 * Values a `src` kind with a finite value set admits, by kind. A String or
 * a Number admits no finite set, so it stays a TYPE-MISMATCH against an Enum.
 *
 * @type {Readonly<Record<string, (type: SchemaType) => readonly (string | boolean)[]>>}
 */
const VALUE_SETS = Object.freeze({
  Enum: type => /** @type {EnumType} */ (type).values,
  Boolean: () => BOOLEANS,
});

/** Step 5: one ENUM-VALUE per value `src` admits that the `dst` enum lacks. */
function enumAssign(
  /** @type {SchemaType} */ s,
  /** @type {EnumType} */ d,
  /** @type {Cursor} */ cur,
) {
  const signature = pairSig(sig(s), sig(d));
  const extra = VALUE_SETS[s.t](s).filter(value => !d.values.includes(value));
  for (const value of extra)
    push(at(cur, `${cur.path}=${enumLiteral(value)}`), 'ENUM-VALUE', signature);
}

/** The `typeof` every Enum value must have to fit each primitive kind. */
const ENUM_VALUE_TYPES = Object.freeze({ String: 'string', Boolean: 'boolean' });

/** An Enum fits a String or a Boolean only when every value has its type. */
function enumPrimitiveAssign(
  /** @type {EnumType} */ s,
  /** @type {SchemaType} */ d,
  /** @type {Cursor} */ cur,
) {
  const type = own(ENUM_VALUE_TYPES, d.t);
  const fits = s.values.every((/** @type {string | boolean} */ value) => typeof value === type);
  if (!fits) push(cur, 'TYPE-MISMATCH', pairSig(sig(s), sig(d)));
}

/** `<src kind>><dst kind>` → comparison; unlisted pairs match only on equal kinds. */
const SHAPES = Object.freeze({
  'Object>Object': (
    /** @type {ObjectType} */ s,
    /** @type {ObjectType} */ d,
    /** @type {Walk} */ cur,
  ) => fieldsLater(s.fields, d.fields, cur),
  'Array>Array': (
    /** @type {ArrayType} */ s,
    /** @type {ArrayType} */ d,
    /** @type {Walk} */ cur,
  ) => {
    const item = at(cur, `${cur.path}[]`);
    cur.todo.push(() => typeAssign(s.item, d.item, item));
  },
  'Enum>Enum': enumAssign,
  'Boolean>Enum': enumAssign,
  'Enum>String': enumPrimitiveAssign,
  'Enum>Boolean': enumPrimitiveAssign,
});

/**
 * One `SHAPES` comparison; its `<src kind>><dst kind>` key fixes both kinds.
 *
 * @typedef {(s: SchemaType, d: SchemaType, cur: Walk) => void} ShapeRule
 */

/** Steps 4–6 on unwrapped, resolved types. */
function shapeAssign(
  /** @type {SchemaType} */ s,
  /** @type {SchemaType} */ d,
  /** @type {Walk} */ cur,
) {
  const rule = own(SHAPES, `${s.t}>${d.t}`);
  if (rule !== undefined) return /** @type {ShapeRule} */ (rule)(s, d, cur);
  if (s.t !== d.t) push(cur, 'TYPE-MISMATCH', pairSig(sig(s), sig(d)));
}
