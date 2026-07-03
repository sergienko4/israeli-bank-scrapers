/**
 * BaNCS transaction sign resolution.
 *
 * <p>BaNCS stores amounts as unsigned magnitudes; direction lives in
 * `TxnType`. Per the maintainer decision, the POST-transaction running
 * balance is the ground truth: `sign = sign(runBal[k] − runBal[k−1])`
 * for chronologically-sorted rows, with a `TxnType` → direction map as
 * the boundary/missing-balance fallback and a loud cross-check log when
 * the two signals disagree (validated on real-E2E). Debits are negative
 * (matches the library's `resolveAmount` credit−debit convention).
 */

import { getDebug } from '../../../Types/Debug.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { readDateIso, readMagnitude, readRunningBalance, readTypeCode } from './BancsFields.js';

const LOG = getDebug(import.meta.url);

/** Lowercased BaNCS type codes known to be debits (outgoing → negative). */
const BANCS_DEBIT_TYPES = new Set(['outpymntord', 'payment']);

/** One transaction reduced to the scalars the sign engine needs. */
interface IBancsRow {
  readonly index: number;
  readonly iso: string;
  readonly magnitude: number;
  readonly runBal: number;
  readonly typeCode: string;
}

/**
 * Parse the unsigned amount magnitude.
 * @param root - Raw BaNCS record.
 * @returns Absolute numeric magnitude (0 when the field is absent).
 */
function parseMagnitude(root: ApiRecord): number {
  const raw = readMagnitude(root);
  const n = Number(raw);
  return Math.abs(n);
}

/**
 * Reduce a raw BaNCS record to an {@link IBancsRow}.
 * @param root - Raw BaNCS record.
 * @param index - Original position in the hunt array.
 * @returns Sign-engine row (index preserved for realignment).
 */
function toRow(root: ApiRecord, index: number): IBancsRow {
  const magnitude = parseMagnitude(root);
  const runBal = readRunningBalance(root);
  const typeCode = readTypeCode(root).toLowerCase();
  const iso = readDateIso(root, 'OrigDt');
  return { index, iso, magnitude, runBal, typeCode };
}

/**
 * Chronological comparator (`YYYY-MM-DD` sorts lexicographically).
 * @param a - Left row.
 * @param b - Right row.
 * @returns Negative/zero/positive per `localeCompare`.
 */
function byIsoAsc(a: IBancsRow, b: IBancsRow): number {
  return a.iso.localeCompare(b.iso);
}

/**
 * Direction sign from the running-balance delta (the ground truth).
 * @param cur - Current row.
 * @param prev - Previous (older) row.
 * @returns -1/+1 from the delta, or 0 when a balance is unusable (NaN).
 */
function deltaSign(cur: IBancsRow, prev: IBancsRow): number {
  if (Number.isNaN(cur.runBal) || Number.isNaN(prev.runBal)) return 0;
  return Math.sign(cur.runBal - prev.runBal);
}

/**
 * Direction sign from the `TxnType` code (boundary fallback).
 * @param code - Lowercased BaNCS type code.
 * @returns -1 for known debits, 0 when the type is unknown.
 */
function typeSign(code: string): number {
  if (BANCS_DEBIT_TYPES.has(code)) return -1;
  return 0;
}

/**
 * Collapse a resolved signal to a concrete sign, defaulting to debit.
 * @param chosen - Resolved signal (-1/0/+1).
 * @returns +1 for a positive signal, -1 otherwise (default debit).
 */
function finalizeSign(chosen: number): number {
  if (chosen > 0) return 1;
  return -1;
}

/**
 * Build the "sign unresolved" warning (PII-safe: index + type code only).
 * @param k - Chronological row index.
 * @param typeCode - Unrecognised type code.
 * @returns Warning message.
 */
function unresolvedMsg(k: number, typeCode: string): string {
  const where = `row ${String(k)} type="${typeCode}"`;
  return `BaNCS sign unresolved (${where}) — default debit; verify on real-E2E`;
}

/**
 * Build the "signs disagree" warning (PII-safe: index + signs only).
 * @param k - Chronological row index.
 * @param delta - Balance-delta sign.
 * @param ts - Type-map sign.
 * @returns Warning message.
 */
function disagreeMsg(k: number, delta: number, ts: number): string {
  const nums = `row ${String(k)} delta=${String(delta)} type=${String(ts)}`;
  return `BaNCS sign disagreement (${nums}) — trusting balance delta`;
}

/**
 * Cross-check the two direction signals; empty string means "no issue".
 * @param k - Chronological row index.
 * @param row - Current row.
 * @param delta - Balance-delta sign.
 * @returns Warning message, or empty string when the signals are fine.
 */
function warnFor(k: number, row: IBancsRow, delta: number): string {
  const ts = typeSign(row.typeCode);
  if (delta === 0 && ts === 0) return unresolvedMsg(k, row.typeCode);
  if (delta !== 0 && ts !== 0 && delta !== ts) return disagreeMsg(k, delta, ts);
  return '';
}

/**
 * Resolve one row's sign: balance-delta first, type fallback + log.
 * @param sorted - Chronologically-sorted rows.
 * @param k - Index into `sorted`.
 * @returns Concrete direction sign (-1/+1).
 */
function resolveSign(sorted: readonly IBancsRow[], k: number): number {
  const cur = sorted[k];
  const delta = k > 0 ? deltaSign(cur, sorted[k - 1]) : 0;
  const message = warnFor(k, cur, delta);
  if (message !== '') LOG.warn({ message });
  return finalizeSign(delta !== 0 ? delta : typeSign(cur.typeCode));
}

/**
 * Map every sorted row to its sign, keyed by original index.
 * @param sorted - Chronologically-sorted rows.
 * @returns Map of original index → direction sign.
 */
function signSorted(sorted: readonly IBancsRow[]): ReadonlyMap<number, number> {
  const entries = sorted.map((row, k): [number, number] => [row.index, resolveSign(sorted, k)]);
  return new Map(entries);
}

/**
 * Compute signed charged amounts aligned to the input order.
 * @param items - Hunt-collected records (BaNCS + any passers-through).
 * @returns Signed amounts; index-aligned to `items`.
 */
function computeSignedAmounts(items: readonly ApiRecord[]): readonly number[] {
  const rows = items.map(toRow);
  const sorted = [...rows].sort(byIsoAsc);
  const signByIndex = signSorted(sorted);
  return rows.map((row): number => (signByIndex.get(row.index) ?? -1) * row.magnitude);
}

export default computeSignedAmounts;
