/**
 * BaNCS balance selection — picks the CURRENT-type balance out of a
 * TCS BaNCS `BalanceList[]` (each entry
 * `{ CurrAmt: { Amt: { Value } }, BalType: { CDE } }`).
 *
 * <p>Default-deny: {@link selectBancsBalance} returns `false` for any
 * body that carries no `BalanceList` with a `CURRENT` BalType, so the
 * generic flat-alias balance BFS in
 * {@link "../../BalanceResolve/BalanceExtractor.js"} runs unchanged for
 * every non-BaNCS bank (Leumi/Discount/VisaCal/Max/Isracard). No other
 * pipeline bank emits `BalType.CDE` beside `CurrAmt.Amt.Value`, so the
 * guard is collision-free.
 *
 * <p>PII-safe: balance magnitudes are financial data and are NEVER
 * logged here — the module is a pure selector with no log sink.
 */

import type { JsonObject, JsonValue } from '../../../Types/JsonValue.js';
import { getIn, isStr } from './BancsShape.js';

/** BalType code for the current-account balance (decision C = the visible 150). */
const CURRENT_BALTYPE = 'CURRENT';

/** Bounded search depth — every captured BaNCS balance shape sits ≤ 4 deep. */
const MAX_DEPTH = 6;

/**
 * Record type guard over a {@link JsonValue}.
 * @param v - Value to test.
 * @returns True when `v` is a non-null, non-array object.
 */
function isObj(v: JsonValue): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse a BaNCS magnitude (string like `"150.00"` or a number) to a
 * finite number, or the `NaN` sentinel when unparseable.
 * @param v - Candidate `CurrAmt.Amt.Value`.
 * @returns Finite number, or `Number.NaN`.
 */
function toFinite(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (!isStr(v)) return Number.NaN;
  const trimmed = v.trim();
  return Number.parseFloat(trimmed);
}

/**
 * Read one `BalanceList[]` entry's amount, but only when its
 * `BalType.CDE` is `CURRENT`; otherwise the `NaN` sentinel.
 * @param entry - One BalanceList element.
 * @returns Finite CURRENT amount, or `Number.NaN`.
 */
function currentEntryAmount(entry: JsonValue): number {
  if (!isObj(entry)) return Number.NaN;
  if (getIn(entry, ['BalType', 'CDE']) !== CURRENT_BALTYPE) return Number.NaN;
  const raw = getIn(entry, ['CurrAmt', 'Amt', 'Value']);
  return toFinite(raw);
}

/**
 * Scan a `BalanceList[]` array for the first CURRENT-type amount.
 * @param list - BalanceList array.
 * @returns First finite CURRENT amount, or `Number.NaN`.
 */
function scanBalanceList(list: readonly JsonValue[]): number {
  const amounts = list.map(currentEntryAmount);
  return amounts.find(Number.isFinite) ?? Number.NaN;
}

/**
 * Try this record's own `BalanceList`, else recurse into its children.
 * @param rec - JSON object node.
 * @param depth - Remaining search depth.
 * @returns Finite CURRENT balance, or `Number.NaN`.
 */
function fromRecord(rec: JsonObject, depth: number): number {
  const list = rec.BalanceList;
  const here = Array.isArray(list) ? scanBalanceList(list) : Number.NaN;
  if (Number.isFinite(here)) return here;
  const children = Object.values(rec);
  return fromChildren(children, depth);
}

/**
 * Recurse a node's children to the bounded depth.
 * @param children - Child JSON values (record values or array items).
 * @param depth - Remaining search depth.
 * @returns First finite CURRENT balance, or `Number.NaN`.
 */
function fromChildren(children: readonly JsonValue[], depth: number): number {
  if (depth <= 0) return Number.NaN;
  const hits = children.map((c): number => descend(c, depth - 1));
  return hits.find(Number.isFinite) ?? Number.NaN;
}

/**
 * Dispatch one node: record → array → scalar miss.
 * @param node - Current JSON node.
 * @param depth - Remaining search depth.
 * @returns Finite CURRENT balance, or `Number.NaN`.
 */
function descend(node: JsonValue, depth: number): number {
  if (isObj(node)) return fromRecord(node, depth);
  if (Array.isArray(node)) return fromChildren(node, depth);
  return Number.NaN;
}

/**
 * Select the BaNCS CURRENT-type balance from a captured response body.
 * @param body - Captured response body (any JSON shape).
 * @returns Finite CURRENT balance, or `false` (default-deny) when the
 *   body carries no BaNCS `BalanceList` with a `CURRENT` BalType.
 */
function selectBancsBalance(body: JsonValue): number | false {
  const found = descend(body, MAX_DEPTH);
  if (Number.isFinite(found)) return found;
  return false;
}

export default selectBancsBalance;
