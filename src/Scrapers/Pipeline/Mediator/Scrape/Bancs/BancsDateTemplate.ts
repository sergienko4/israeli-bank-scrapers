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
 * <p>Default-deny (fail-closed): the body is mutated only when
 * {@link isBancsTxnBody} recognises it, and each node only when it
 * carries a classifiable `Operator` and an `OrigDt` object; every other
 * bank's body — and every unrecognised node — is left untouched, so the
 * generic monthly-chunk replay is a provable no-op for non-BaNCS banks.
 */

import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { getIn } from './BancsShape.js';
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
 * Rewrite a BaNCS CURRENT_ACCOUNT query's two `OrigDt` bounds with the
 * iteration's month chunk. Default-deny — a no-op for non-BaNCS bodies.
 * @param body - The per-chunk cloned POST body (mutated in place).
 * @param chunk - The month chunk (UTC ISO start/end).
 * @returns True when `body` was a BaNCS txn body (and thus rewritten).
 */
function applyBancsChunkRange(body: ApiRecord, chunk: IChunkRange): boolean {
  if (!isBancsTxnBody(body)) return false;
  const from = toDatePart(chunk.start);
  const to = toDatePart(chunk.end);
  for (const node of innerFilterNodes(body)) {
    applyNode(node, from, to);
  }
  return true;
}

export default applyBancsChunkRange;
