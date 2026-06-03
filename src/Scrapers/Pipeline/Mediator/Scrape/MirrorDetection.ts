/**
 * Mirror detection — fingerprint-based duplicate account detection.
 * Detects when multiple accounts received identical transaction data
 * (same dates, amounts, descriptions) across different card IDs.
 */

import { getDebug as createLogger } from '../../Types/Debug.js';

const LOG = createLogger('scrape-phase');

/** Three-way comparison sentinel returned by {@link compareLocale}. */
type CompareSign = -1 | 0 | 1;

/**
 * Locale-aware comparator wrapping String.localeCompare. Sonar S2871
 * wants an explicit compare function; Rule #15 forbids primitive
 * number returns from Pipeline functions, so the result is narrowed
 * to a CompareSign sentinel.
 * @param a - First string.
 * @param b - Second string.
 * @returns -1 when a < b, 0 when equal, 1 when a > b.
 */
function compareLocale(a: string, b: string): CompareSign {
  const result = a.localeCompare(b);
  if (result < 0) return -1;
  if (result > 0) return 1;
  return 0;
}

/** Minimal account shape for mirror detection. */
interface IMirrorAccount {
  readonly accountNumber: string;
  readonly txns: readonly ITxnFingerFields[];
}

/** Minimal transaction fields needed for fingerprinting. */
interface ITxnFingerFields {
  readonly date: string;
  readonly originalAmount?: number;
  readonly chargedAmount?: number;
  readonly description?: string;
}

/** Mirror detection result. */
interface IMirrorResult {
  readonly isMirrored: boolean;
  readonly message: string;
}

/**
 * Build canonical string for one transaction.
 * @param txn - Transaction with date, amount, description.
 * @returns Pipe-delimited canonical string.
 */
function canonicalizeTxn(txn: ITxnFingerFields): string {
  const amount = txn.originalAmount ?? txn.chargedAmount ?? 0;
  return `${txn.date}|${String(amount)}|${txn.description ?? ''}`;
}

/**
 * Compute fingerprint for an account's transactions.
 * @param account - Account with transactions.
 * @returns Sorted canonical string joined by newlines.
 */
function computeFingerprint(account: IMirrorAccount): string {
  const canonicals = account.txns.map(canonicalizeTxn);
  // Explicit localeCompare for locale-stable string ordering.
  const sorted = [...canonicals].sort(compareLocale);
  return sorted.join('\n');
}

/**
 * Compute the unique-fingerprint count and return the mirror-positive
 * result when duplicates exist. Pulled out so
 * {@link detectMirroredAccounts} stays a thin guard/branch dispatch.
 *
 * @param fingerprints - Non-empty fingerprint list (empties filtered).
 * @returns Detection result — mirror-positive or `all-unique`.
 */
function decideMirrorByFingerprints(fingerprints: readonly string[]): IMirrorResult {
  const uniqueCount = new Set(fingerprints).size;
  const totalCount = fingerprints.length;
  if (uniqueCount === totalCount) return { isMirrored: false, message: 'all-unique' };
  const dupCount = String(totalCount - uniqueCount + 1);
  const msg = `MIRROR_SUSPECT: ${dupCount} of ${String(totalCount)} accounts share fingerprint`;
  LOG.warn({ message: msg });
  return { isMirrored: true, message: msg };
}

/**
 * Detect mirrored accounts — multiple accounts with identical fingerprints.
 *
 * <p>Accounts whose fingerprint is the empty string (zero transactions
 * in the captured window) are excluded from the duplicate scan. Empty
 * fingerprints naturally collide and would surface a false-positive
 * `MIRROR_SUSPECT` whenever a card is dormant or fully closed inside
 * the lookback window — confirmed live for Amex/Isracard inactive
 * cards, where 3 zero-txn cards triggered an audit warning despite
 * the active cards being fully unique.
 *
 * @param accounts - All scraped accounts.
 * @returns Detection result with diagnostic message.
 */
function detectMirroredAccounts(accounts: readonly IMirrorAccount[]): IMirrorResult {
  if (accounts.length < 2) return { isMirrored: false, message: 'single-account' };
  const fingerprints = accounts.map(computeFingerprint).filter((fp): boolean => fp.length > 0);
  if (fingerprints.length < 2) return { isMirrored: false, message: 'all-unique' };
  return decideMirrorByFingerprints(fingerprints);
}

export type { IMirrorResult };
export { detectMirroredAccounts };
