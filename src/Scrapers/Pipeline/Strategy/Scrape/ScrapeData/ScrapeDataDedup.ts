/**
 * Scrape dedup leaves — rate limiting, date parsing, transaction
 * hashing + window/duplicate collapsing. Drained from
 * `ScrapeDataActions.ts` during the Phase 12e file-size split; the
 * public surface is re-exported verbatim from the barrel facade.
 */

import { setTimeout as timerWait } from 'node:timers/promises';

import type { ITransaction } from '../../../../../Transactions.js';
import ScraperError from '../../../../Base/ScraperError.js';
import type { Brand } from '../../../Types/Brand.js';

/** Pipe-delimited transaction hash. */
type TxnHashKey = Brand<string, 'TxnHashKey'>;
/** After-start-date predicate result. */
type IsAfterStartDate = Brand<boolean, 'IsAfterStartDate'>;
/** Dedup retain predicate result. */
type ShouldRetainTxn = Brand<boolean, 'ShouldRetainTxn'>;

/**
 * Pause execution for rate limiting between API calls.
 * Uses node:timers/promises because no browser page is
 * available in the API-only scrape context.
 * @param ms - Milliseconds to pause.
 * @returns True when the pause completes.
 */
async function rateLimitPause(ms: number): Promise<true> {
  await timerWait(ms);
  return true;
}

/**
 * Parse YYYYMMDD to Date.
 * @param raw - Date string in YYYYMMDD format.
 * @returns Parsed Date.
 */
function parseStartDate(raw: string): Date {
  const fmt = raw.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  return new Date(fmt);
}

/** Stringified `undefined` produced by `String(undefined)` — used by the
 * row-shape guard below to detect catastrophic missing-field rows. */
const UNDEFINED_SENTINEL = 'undefined';

/**
 * Composes the dedup key for a transaction by joining the values of
 * the named fields with the `|` delimiter.
 *
 * <p>Phase G (2026-05-14): the field-name array `dedupKeyFields`
 * is supplied by DASHBOARD.FINAL per-card and travels through the
 * harvest contract. Typical contents are `['identifier']` when
 * the bank emits a per-txn unique id, or
 * `['date', 'identifier', 'originalAmount']` when the
 * identifier collides across rows (Beinleumi's `reference` is a
 * transaction-TYPE code shared by recurring monthly txns).
 *
 * <p>Defensive runtime guards (CodeRabbit review 2026-05-15):
 * <ul>
 *   <li><b>Empty tuple</b> — DASHBOARD always emits a non-empty
 *     array; an empty `dedupKeyFields` would hash every row to the
 *     empty string and collapse every transaction into one. Throws
 *     `DEDUP_KEY_FIELDS_EMPTY`.</li>
 *   <li><b>All-undefined row</b> — when every named field is
 *     absent on a row, the join hash degenerates to
 *     `"undefined|undefined|..."` and unrelated rows collide into
 *     one (frozen-mode replay or test mock without a DASHBOARD
 *     harvest). The fallback emits a per-row fingerprint hash
 *     based on the full row's JSON shape so distinct rows stay
 *     distinct without throwing.</li>
 * </ul>
 *
 * @param t - Transaction whose fields supply the key components.
 * @param dedupKeyFields - Non-empty array of {@link ITransaction}
 *   field names. Order is significant — emitted key joins values in
 *   the given order.
 * @returns Composed dedup key string.
 * @throws {ScraperError} `DEDUP_KEY_FIELDS_EMPTY` when the tuple is
 *   empty.
 */
function txnHash(t: ITransaction, dedupKeyFields: readonly string[]): TxnHashKey {
  if (dedupKeyFields.length === 0) {
    throw new ScraperError(
      'DEDUP_KEY_FIELDS_EMPTY: dedupKeyFields contract violation — must be non-empty',
    );
  }
  const row = t as unknown as Record<string, unknown>;
  const values = dedupKeyFields.map((field): string => String(row[field]));
  if (values.every((value): boolean => value === UNDEFINED_SENTINEL)) {
    return `_degenerate:${JSON.stringify(t)}` as TxnHashKey;
  }
  return values.join('|') as TxnHashKey;
}

/**
 * Filters txns to a start-date window, collapses duplicates by
 * {@link txnHash}, then sorts newest-first.
 *
 * <p>Phase G (2026-05-14): the dedup key is now driven by
 * `dedupKeyFields` — a field-name array chosen per-card by
 * DASHBOARD.FINAL and threaded through the harvest contract. The
 * function no longer infers a key from the row's shape; callers
 * supply the explicit tuple.
 *
 * <p>R-DEDUP-IDEMPOTENT invariant: a second pass over an
 * already-deduped array with the same tuple is a no-op — sister
 * strategies that call this factory before {@link buildAccountResult}
 * are safe to double-call.
 *
 * <p>Sort step (Phase F): the matrix-loop concatenates chunks in
 * oldest-cycle-first iteration order, producing interleaved
 * by-cycle output. Sorting at the factory boundary gives every
 * caller a chronological newest-first view regardless of upstream
 * order.
 *
 * @param allTxns - Raw transactions concatenated from one or more
 *   bank-API responses.
 * @param startMs - Inclusive window lower bound as epoch ms.
 * @param dedupKeyFields - Non-empty array of {@link ITransaction}
 *   field names used to compose each row's dedup key. Sourced from
 *   {@link IDashboardTxnHarvest.dedupKeyFieldsByAccount} per card.
 * @returns In-range unique transactions sorted by `date` descending.
 */
function deduplicateTxns(
  allTxns: readonly ITransaction[],
  startMs: number,
  dedupKeyFields: readonly string[],
): readonly ITransaction[] {
  const afterStart = allTxns.filter(
    (t): IsAfterStartDate => (new Date(t.date).getTime() >= startMs) as IsAfterStartDate,
  );
  const seen = new Set<string>();
  const unique = afterStart.filter((t): ShouldRetainTxn => {
    const key = txnHash(t, dedupKeyFields);
    if (seen.has(key)) return false as ShouldRetainTxn;
    seen.add(key);
    return true as ShouldRetainTxn;
  });
  return [...unique].sort(
    (a, b): number => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/**
 * Phase G ergonomic fallback when `fc.dedupKeyFields` is absent
 * (legacy test mocks, frozen-mode replays that pre-date Phase G).
 * Production SCRAPE.PRE always populates `fc.dedupKeyFields` from
 * the harvest, so this constant is dead in live runs.
 *
 * <p>Typed via `as const` (CodeRabbit review 2026-05-15) so the
 * literal tuple shape is preserved through `readonly ['identifier']`,
 * preventing accidental mutation or assignment of an unrelated
 * string array at any consumer.
 */
const FALLBACK_DEDUP_KEY_FIELDS = ['identifier'] as const;

export { deduplicateTxns, FALLBACK_DEDUP_KEY_FIELDS, parseStartDate, rateLimitPause, txnHash };
