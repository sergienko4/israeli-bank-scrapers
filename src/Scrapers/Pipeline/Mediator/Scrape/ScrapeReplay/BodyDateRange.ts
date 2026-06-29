/**
 * Nested date-range substitution for BaNCS-style transaction bodies
 * (Yahav). The captured template carries an AND-filter pair whose
 * `OrigDt` bounds use `GREATERTHANOREQUAL` (from) / `LESSTHANOREQUAL`
 * (to); the cycle loop rewrites those bounds per month-chunk. Banks
 * with top-level Month/Year stay untouched — only an Operator+OrigDt
 * node triggers detection, so non-BaNCS bodies are byte-identical.
 */

import type { JsonNode } from '../JsonTraversal.js';
import type { JsonRecord } from './JsonTypes.js';

const OP_FROM = 'GREATERTHANOREQUAL';
const OP_TO = 'LESSTHANOREQUAL';
const MAX_RANGE_DEPTH = 15;

/** Calendar bounds rewritten into the GE/LE OrigDt nodes. */
interface IDateBounds {
  readonly from: Date;
  readonly to: Date;
}

/**
 * Test a value as a searchable record (non-null, non-array object).
 * @param v - Value to inspect.
 * @returns True when v is a plain record.
 */
function isRec(v: JsonNode): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Flatten one value into its child records (arrays + objects).
 * @param v - Value to inspect.
 * @returns Child records for BFS.
 */
function childRecs(v: JsonNode): JsonRecord[] {
  if (Array.isArray(v)) return v.filter(isRec);
  return isRec(v) ? [v] : [];
}

/**
 * Is this node a GE/LE OrigDt range bound?
 * @param node - Candidate record.
 * @returns True when it carries Operator GE/LE + OrigDt object.
 */
function isRangeNode(node: JsonRecord): boolean {
  const op = node.Operator;
  return (op === OP_FROM || op === OP_TO) && isRec(node.OrigDt);
}

/**
 * Set a node's OrigDt Day/Month/Year from a Date (preserving Ver).
 * @param node - Range node to mutate.
 * @param d - Calendar bound.
 */
function setOrigDt(node: JsonRecord, d: Date): void {
  const dt = node.OrigDt as JsonRecord;
  dt.Day = d.getDate();
  dt.Month = d.getMonth() + 1;
  dt.Year = d.getFullYear();
}

/**
 * Rewrite one range node's bound to from (GE) or to (LE).
 * @param node - Range node.
 * @param b - Calendar bounds.
 */
function applyNode(node: JsonRecord, b: IDateBounds): void {
  setOrigDt(node, node.Operator === OP_FROM ? b.from : b.to);
}

/**
 * BFS all records, run a visitor on each. Bounded depth guards loops.
 * @param queue - Current level.
 * @param visit - Per-node visitor.
 * @param depth - Remaining depth.
 */
function walk(queue: readonly JsonRecord[], visit: (n: JsonRecord) => void, depth: number): void {
  if (queue.length === 0 || depth <= 0) return;
  const next = queue.flatMap((o): JsonRecord[] => {
    visit(o);
    return Object.values(o).flatMap(childRecs);
  });
  walk(next, visit, depth - 1);
}

/**
 * Detect a nested GE/LE OrigDt date-range template.
 * @param template - Captured POST body string.
 * @returns True when a range node exists.
 */
function isDateRangeBody(template: string): boolean {
  if (!template) return false;
  let hasHit = false;
  try {
    const root = JSON.parse(template) as JsonRecord;
    walk(
      [root],
      (n): void => {
        hasHit = hasHit || isRangeNode(n);
      },
      MAX_RANGE_DEPTH,
    );
  } catch {
    return false;
  }
  return hasHit;
}

/**
 * Rewrite all GE/LE OrigDt bounds to the chunk's [from,to] window.
 * @param body - Parsed body to mutate.
 * @param bounds - Calendar bounds for the chunk.
 */
function applyDateRangeToBody(body: JsonRecord, bounds: IDateBounds): void {
  walk(
    [body],
    (n): void => {
      if (isRangeNode(n)) applyNode(n, bounds);
    },
    MAX_RANGE_DEPTH,
  );
}

export { applyDateRangeToBody, isDateRangeBody };
export type { IDateBounds };
