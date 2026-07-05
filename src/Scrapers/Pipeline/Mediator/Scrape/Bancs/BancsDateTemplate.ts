/**
 * BaNCS transactions date-range replay templating — the WRITE side that
 * complements {@link "./BancsTxnRequest.js"} recognition.
 *
 * <p>A captured BaNCS CURRENT_ACCOUNT query carries its own (captured)
 * window as two `Payload.Filters[].Filters[].OrigDt {Day,Month,Year}`
 * calendar bounds, tagged by `Operator` (GREATERTHAN* = from,
 * LESSTHAN* = to). {@link applyBancsChunkRange} rewrites those two
 * bounds with the iteration's month chunk so the replayed request
 * honours the user's requested `startDate`→today window instead of the
 * captured one.
 *
 * <p>The upper (to) bound is capped at today: BaNCS returns an empty
 * envelope when the to-bound is a future date, so a current-month chunk
 * whose calendar end is month-end (still in the future) would otherwise
 * silently drop today's already-settled transactions.
 *
 * <p>Default-deny (fail-closed): the body is mutated only when
 * {@link isBancsTxnBody} recognises it, and each node only when it
 * carries a classifiable `Operator` and an `OrigDt` object; every other
 * bank's body — and every unrecognised node — is left untouched, so the
 * generic monthly-chunk replay is a provable no-op for non-BaNCS banks.
 */

import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { getIn, isNum } from './BancsShape.js';
import { innerFilterNodes, isBancsTxnBody } from './BancsTxnRequest.js';

/** A calendar date split into BaNCS numeric parts. */
interface IDatePart {
  readonly Day: number;
  readonly Month: number;
  readonly Year: number;
}

/** Minimal month-chunk surface — UTC ISO start/end strings. */
interface IChunkRange {
  readonly start: string;
  readonly end: string;
}

/** BaNCS operators marking the range's lower (from) bound. */
const FROM_OPERATORS = new Set(['GREATERTHANOREQUAL', 'GREATERTHAN']);

/** BaNCS operators marking the range's upper (to) bound. */
const TO_OPERATORS = new Set(['LESSTHANOREQUAL', 'LESSTHAN']);

/**
 * Split a UTC ISO timestamp into BaNCS `{Day,Month,Year}` parts.
 * @param iso - UTC ISO timestamp (a month chunk's start/end).
 * @returns The calendar date in BaNCS numeric form.
 */
function toDatePart(iso: string): IDatePart {
  const d = new Date(iso);
  return { Day: d.getUTCDate(), Month: d.getUTCMonth() + 1, Year: d.getUTCFullYear() };
}

/**
 * Read a node's `Operator` string, or empty when absent/non-string.
 * @param node - One inner filter record.
 * @returns The operator string (empty when missing).
 */
function readOperator(node: ApiRecord): string {
  const op = getIn(node, ['Operator']);
  return typeof op === 'string' ? op : '';
}

/**
 * Resolve the bound for one operator, or false when unclassifiable.
 * @param operator - The node's BaNCS `Operator` string.
 * @param from - Lower-bound (from) date part.
 * @param to - Upper-bound (to) date part.
 * @returns The matching bound, or false for an unrecognised operator.
 */
function boundForOperator(operator: string, from: IDatePart, to: IDatePart): IDatePart | false {
  if (FROM_OPERATORS.has(operator)) return from;
  if (TO_OPERATORS.has(operator)) return to;
  return false;
}

/**
 * Overwrite a node's `OrigDt` parts in place, preserving other keys.
 * @param node - One inner filter record carrying an `OrigDt` object.
 * @param part - The calendar parts to write.
 * @returns True when an `OrigDt` object was found and rewritten.
 */
function writeOrigDt(node: ApiRecord, part: IDatePart): boolean {
  const origDt = getIn(node, ['OrigDt']);
  if (origDt === null || typeof origDt !== 'object') return false;
  Object.assign(origDt, part);
  return true;
}

/**
 * Rewrite one inner filter node's bound when its operator classifies.
 * @param node - One `Payload.Filters[].Filters[]` record.
 * @param from - Lower-bound (from) date part.
 * @param to - Upper-bound (to) date part.
 * @returns True when the node's `OrigDt` was rewritten.
 */
function applyNode(node: ApiRecord, from: IDatePart, to: IDatePart): boolean {
  const operator = readOperator(node);
  const part = boundForOperator(operator, from, to);
  if (part === false) return false;
  return writeOrigDt(node, part);
}

/**
 * Today's date as BaNCS calendar parts, using the local calendar to match
 * the month-chunk generator's local date extraction. Exported so the
 * BancsDateTemplate to-bound-cap test asserts against this exact source of
 * truth instead of duplicating the extraction.
 * @returns Today as `{Day,Month,Year}`.
 */
export function todayDatePart(): IDatePart {
  const now = new Date();
  const month = now.getMonth() + 1;
  return { Day: now.getDate(), Month: month, Year: now.getFullYear() };
}

/**
 * A calendar date's chronological ordinal (YYYYMMDD) for comparison.
 * @param part - A BaNCS calendar date.
 * @returns The comparable ordinal.
 */
function partOrdinal(part: IDatePart): number {
  return part.Year * 10000 + part.Month * 100 + part.Day;
}

/**
 * The chunk's upper (to) bound, never later than today — BaNCS empties
 * the response for a future to-bound, which would drop today's settled
 * transactions from a current-month chunk ending at month-end.
 * @param endIso - The month chunk's UTC ISO end timestamp.
 * @returns The to-bound calendar parts, capped at today.
 */
function cappedToBound(endIso: string): IDatePart {
  const endPart = toDatePart(endIso);
  const today = todayDatePart();
  const endOrd = partOrdinal(endPart);
  const todayOrd = partOrdinal(today);
  return endOrd > todayOrd ? today : endPart;
}

/**
 * Rewrite a BaNCS CURRENT_ACCOUNT query's two `OrigDt` bounds with the
 * iteration's month chunk. Default-deny — a no-op for non-BaNCS bodies.
 * @param body - The per-chunk cloned POST body (mutated in place).
 * @param chunk - The month chunk (UTC ISO start/end).
 * @returns True when `body` was a BaNCS txn body (and thus rewritten).
 */
function applyBancsChunkRange(body: ApiRecord, chunk: IChunkRange): boolean {
  if (!isBancsTxnBody(body)) return false;
  const from = toDatePart(chunk.start);
  const to = cappedToBound(chunk.end);
  for (const node of innerFilterNodes(body)) {
    applyNode(node, from, to);
  }
  return true;
}

export default applyBancsChunkRange;

/**
 * Build a UTC Date from a BaNCS `OrigDt {Day,Month,Year}` (Month is
 * 1-based), or false when any part is missing or non-numeric.
 * @param origDt - The `OrigDt` sub-record of one inner filter node.
 * @returns The calendar date (UTC), or false.
 */
function origDtToDate(origDt: ApiRecord): Date | false {
  const day = getIn(origDt, ['Day']);
  const month = getIn(origDt, ['Month']);
  const year = getIn(origDt, ['Year']);
  if (isNum(day) && isNum(month) && isNum(year)) {
    const utcMs = Date.UTC(year, month - 1, day);
    return new Date(utcMs);
  }
  return false;
}

/**
 * The lower (from) bound date of one node — present only when the node
 * carries a `GREATERTHAN*` operator and an `OrigDt`.
 * @param node - One `Payload.Filters[].Filters[]` record.
 * @returns The from-bound date, or false.
 */
function fromBoundDate(node: ApiRecord): Date | false {
  const operator = readOperator(node);
  if (!FROM_OPERATORS.has(operator)) return false;
  const origDt = getIn(node, ['OrigDt']);
  if (origDt === null || typeof origDt !== 'object') return false;
  return origDtToDate(origDt as ApiRecord);
}

/**
 * Read the captured lower (from) date bound of a BaNCS CURRENT_ACCOUNT
 * body — the `GREATERTHAN*` `OrigDt`. The READ complement of
 * {@link applyBancsChunkRange}: the SCRAPE firstWave gate uses it to tell
 * a narrow dashboard-preview window (fromDate after the requested start)
 * from one that already covers the user's requested range. Default-deny —
 * `false` for any non-BaNCS body, so the gate is a no-op for other banks.
 * @param body - Parsed request body (the committed `templatePostData`).
 * @returns The captured fromDate (UTC), or false.
 */
export function readBancsFromDate(body: ApiRecord): Date | false {
  if (!isBancsTxnBody(body)) return false;
  const nodes = innerFilterNodes(body);
  const dates = nodes.map(fromBoundDate);
  return dates.find((d): d is Date => d !== false) ?? false;
}
