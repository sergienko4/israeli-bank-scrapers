/**
 * Redacted answer shape, logged when an answer is unrecognized or
 * ambiguous; no value is ever printed. A scalar becomes its JSON type, an
 * object keeps its key positions (never bank-supplied names) and an array its
 * items. Each key is printed as `<key:i>`, its position.
 * Six levels are walked; a deeper container becomes `object(n)` or
 * `array(n)`. At most 64 entries (keys and items) are shown in all, the
 * shallower first; a cut object ends with `'...': '+n'`, a cut array with
 * `'...+n'`.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import type { IJsonObject, JsonArray } from '../Envelope/JsonPointer.js';
import { isPlainObject } from '../Envelope/JsonPointer.js';
import type { JsonValue } from './RunStep.types.js';

/** Containers walked from the root down. */
const MAX_DEPTH = 6;

/** Entries shown in all. */
const MAX_ENTRIES = 64;

/** Marks a cut container. */
const CUT = '...';

/** One printed object entry. */
type ShapeEntry = [string, JsonValue];

/** Entries still to show; shared by the whole walk. */
interface IShapeBudget {
  left: number;
}

/** Where the walk stands. */
interface IShapeWalk {
  readonly depth: number;
  readonly budget: IShapeBudget;
}

/**
 * Take up to `count` entries from the budget.
 * @param count - Entries a container holds.
 * @param budget - Shared budget.
 * @returns Entries the container shows.
 */
function takeEntries(count: number, budget: IShapeBudget): number {
  const kept = Math.min(count, budget.left);
  budget.left -= kept;
  return kept;
}

/**
 * The walk one level down.
 * @param walk - Current walk.
 * @returns The walk of a child.
 */
function deeper(walk: IShapeWalk): IShapeWalk {
  return { depth: walk.depth + 1, budget: walk.budget };
}

/**
 * A bank-controlled key's position without its name.
 * @param index - Its position.
 * @returns The anonymous `<key:i>` marker.
 */
function printedKey(index: number): string {
  return `<key:${String(index)}>`;
}

/**
 * Shape an array.
 * @param items - Array items.
 * @param walk - Current walk.
 * @returns Item shapes, or `array(n)` below the depth.
 */
function shapeItems(items: JsonArray, walk: IShapeWalk): JsonValue {
  if (walk.depth >= MAX_DEPTH) return `array(${String(items.length)})`;
  const kept = takeEntries(items.length, walk.budget);
  const child = deeper(walk);
  const shown = items.slice(0, kept).map(item => shapeOf(item, child));
  if (kept === items.length) return shown;
  return [...shown, `${CUT}+${String(items.length - kept)}`];
}

/**
 * The marker entry of a cut object.
 * @param total - Keys the object holds.
 * @param kept - Keys shown.
 * @returns The `'...': '+n'` entry, or none when nothing was cut.
 */
function cutEntries(total: number, kept: number): ShapeEntry[] {
  if (total === kept) return [];
  return [[CUT, `+${String(total - kept)}`]];
}

/**
 * Build the mapper from an object's key to its printed entry.
 * @param object - Answer object.
 * @param child - The walk of its values.
 * @returns The entry mapper.
 */
function entryOf(
  object: IJsonObject,
  child: IShapeWalk,
): (key: string, index: number) => ShapeEntry {
  return (key, index): ShapeEntry => {
    const shape = shapeOf(object[key], child);
    return [printedKey(index), shape];
  };
}

/**
 * Shape an object.
 * @param object - Answer object.
 * @param walk - Current walk.
 * @returns Key shapes, or `object(n)` below the depth.
 */
function shapeKeys(object: IJsonObject, walk: IShapeWalk): JsonValue {
  const keys = Object.keys(object);
  if (walk.depth >= MAX_DEPTH) return `object(${String(keys.length)})`;
  const kept = takeEntries(keys.length, walk.budget);
  const child = deeper(walk);
  const toEntry = entryOf(object, child);
  const shown = keys.slice(0, kept).map((key, index): ShapeEntry => toEntry(key, index));
  const cut = cutEntries(keys.length, kept);
  return Object.fromEntries([...shown, ...cut]);
}

/**
 * Shape any value.
 * @param value - Answer value.
 * @param walk - Current walk.
 * @returns Its shape.
 */
function shapeOf(value: JsonValue, walk: IShapeWalk): JsonValue {
  if (Array.isArray(value)) return shapeItems(value, walk);
  if (isPlainObject(value)) return shapeKeys(value, walk);
  return value === null ? 'null' : typeof value;
}

/**
 * Redact an answer to its shape.
 * @param value - Opened answer.
 * @returns The shape, holding no value.
 */
function answerShape(value: JsonValue): JsonValue {
  const walk: IShapeWalk = { depth: 0, budget: { left: MAX_ENTRIES } };
  return shapeOf(value, walk);
}

export default answerShape;

export { answerShape };
