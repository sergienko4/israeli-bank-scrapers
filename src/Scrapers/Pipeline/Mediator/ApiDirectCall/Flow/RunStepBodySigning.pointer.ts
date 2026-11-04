/**
 * JSON-pointer write helper used by the body-signing pipeline.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { DocObj, DocValue } from './RunStepBodySigning.types.js';

/** A mutable object or array along a JSON pointer. */
type DocContainer = DocObj | unknown[];

const INVALID_INDEX = 'writeAtPointer: invalid array index';
const INVALID_SEGMENT = 'writeAtPointer: invalid pointer segment';

/**
 * Whether a JSON value can contain another pointer segment.
 * @param value - Existing child.
 * @returns True for non-null objects and arrays.
 */
function isDocContainer(value: unknown): value is DocContainer {
  return value !== null && typeof value === 'object';
}

/**
 * Objects accept field names; arrays require an existing canonical index.
 * @param cursor - Container being addressed.
 * @param key - Decoded pointer segment.
 * @returns Whether the segment can be written without changing the container shape.
 */
function isWritableSlot(cursor: DocContainer, key: string): boolean {
  if (!Array.isArray(cursor)) return true;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < cursor.length && String(index) === key;
}

/**
 * Decode an RFC-6901 pointer into its escaped segments (~0 → ~, ~1 → /).
 * @param pointer - RFC-6901 pointer (must start with `/`).
 * @returns Decoded segments (empty when malformed).
 */
function decodePointerSegments(pointer: string): readonly string[] {
  if (!pointer.startsWith('/')) return [];
  const raw = pointer.slice(1).split('/');
  return raw.map((p): string => {
    const decodedSlash = p.replaceAll('~1', '/');
    return decodedSlash.replaceAll('~0', '~');
  });
}

/**
 * Keep an existing child container or create a fresh empty object (mutating).
 * @param parent - Parent object or array.
 * @param key - Child key.
 * @returns The child (existing or freshly created).
 */
function pickOrCreateChild(parent: DocContainer, key: string): DocContainer {
  const existing: unknown = Array.isArray(parent) ? parent[Number(key)] : parent[key];
  if (isDocContainer(existing)) return existing;
  const fresh: DocObj = {};
  Object.assign(parent, { [key]: fresh });
  return fresh;
}

/** Args bundle for `descendAndWrite` — keeps recursion params ≤3. */
interface IDescendArgs {
  readonly cursor: DocContainer;
  readonly parts: readonly string[];
  readonly value: DocValue;
  readonly root: DocObj;
}

/**
 * Write to a validated terminal pointer segment.
 * @param args - Descent bundle.
 * @param key - Validated segment.
 * @returns Procedure with the root document.
 */
function writeFinalSegment(args: IDescendArgs, key: string): Procedure<DocObj> {
  Object.assign(args.cursor, { [key]: args.value });
  return succeed(args.root);
}

/**
 * Descend through pointer segments, creating intermediate objects, and
 * write `value` at the final segment.
 * @param args - Descent bundle.
 * @returns Procedure with the root document.
 */
function descendAndWrite(args: IDescendArgs): Procedure<DocObj> {
  const [head, ...tail] = args.parts;
  if (head === '__proto__') return fail(ScraperErrorTypes.Generic, INVALID_SEGMENT);
  if (!isWritableSlot(args.cursor, head)) return fail(ScraperErrorTypes.Generic, INVALID_INDEX);
  if (tail.length === 0) return writeFinalSegment(args, head);
  const next = pickOrCreateChild(args.cursor, head);
  return descendAndWrite({ cursor: next, parts: tail, value: args.value, root: args.root });
}

/**
 * Write a JSON pointer through object fields and existing array entries.
 * @param doc - Mutable JSON object (top-level must be a plain object).
 * @param pointer - RFC-6901 pointer (e.g. `/auth/signature`).
 * @param value - Value to write at the pointer.
 * @returns Procedure with the (mutated) doc on success.
 */
function writeAtPointer(doc: DocObj, pointer: string, value: DocValue): Procedure<DocObj> {
  const parts = decodePointerSegments(pointer);
  if (parts.length === 0) {
    return fail(ScraperErrorTypes.Generic, `writeAtPointer: invalid pointer: ${pointer}`);
  }
  return descendAndWrite({ cursor: doc, parts, value, root: doc });
}

export default writeAtPointer;

export { writeAtPointer };
