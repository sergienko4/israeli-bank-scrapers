/**
 * JSON-pointer write helper used by the body-signing pipeline.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { DocObj, DocValue } from './RunStepBodySigning.types.js';

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
 * Pick the child object at `key` or create a fresh empty one (mutating).
 * @param parent - Parent object.
 * @param key - Child key.
 * @returns The child (existing or freshly created).
 */
function pickOrCreateChild(parent: DocObj, key: string): DocObj {
  const existing = parent[key];
  if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as DocObj;
  }
  const fresh: DocObj = {};
  parent[key] = fresh;
  return fresh;
}

/** Args bundle for `descendAndWrite` — keeps recursion params ≤3. */
interface IDescendArgs {
  readonly cursor: DocObj;
  readonly parts: readonly string[];
  readonly value: DocValue;
  readonly root: DocObj;
}

/**
 * Descend through pointer segments, creating intermediate objects, and
 * write `value` at the final segment.
 * @param args - Descent bundle.
 * @returns Procedure with the root document.
 */
function descendAndWrite(args: IDescendArgs): Procedure<DocObj> {
  const head = args.parts[0];
  const tail = args.parts.slice(1);
  if (tail.length === 0) {
    args.cursor[head] = args.value;
    return succeed(args.root);
  }
  const next = pickOrCreateChild(args.cursor, head);
  return descendAndWrite({ cursor: next, parts: tail, value: args.value, root: args.root });
}

/**
 * Write a value at a JSON pointer inside a mutable plain object.
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
