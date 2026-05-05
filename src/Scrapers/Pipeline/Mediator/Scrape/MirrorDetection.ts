/**
 * Mirror detection — fingerprint-based duplicate account detection.
 * Detects when multiple accounts received identical transaction data
 * (same dates, amounts, descriptions) across different card IDs.
 */

import { getDebug as createLogger } from '../../Types/Debug.js';

const LOG = createLogger('scrape-phase');

/** Whether mirroring was detected across accounts. */
type IsMirrored = boolean;
/** Canonical string fingerprint of an account's transaction set. */
type TxnFingerprint = string;
/** Account number identifier. */
type AccountNum = string;
/** Transaction date string. */
type TxnDateStr = string;
/** Transaction amount. */
type TxnAmount = number;
/** Transaction description text. */
type TxnDescStr = string;
/** Diagnostic message string. */
type DiagMessage = string;

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
  readonly accountNumber: AccountNum;
  readonly txns: readonly ITxnFingerFields[];
}

/** Minimal transaction fields needed for fingerprinting. */
interface ITxnFingerFields {
  readonly date: TxnDateStr;
  readonly originalAmount?: TxnAmount;
  readonly chargedAmount?: TxnAmount;
  readonly description?: TxnDescStr;
}

/** Mirror detection result. */
interface IMirrorResult {
  readonly isMirrored: IsMirrored;
  readonly message: DiagMessage;
}

/**
 * Build canonical string for one transaction.
 * @param txn - Transaction with date, amount, description.
 * @returns Pipe-delimited canonical string.
 */
function canonicalizeTxn(txn: ITxnFingerFields): TxnFingerprint {
  const amount = txn.originalAmount ?? txn.chargedAmount ?? 0;
  return `${txn.date}|${String(amount)}|${txn.description ?? ''}`;
}

/**
 * Compute fingerprint for an account's transactions.
 * @param account - Account with transactions.
 * @returns Sorted canonical string joined by newlines.
 */
function computeFingerprint(account: IMirrorAccount): TxnFingerprint {
  const canonicals = account.txns.map(canonicalizeTxn);
  // Explicit localeCompare for locale-stable string ordering.
  const sorted = [...canonicals].sort(compareLocale);
  return sorted.join('\n');
}

/**
 * Detect mirrored accounts — multiple accounts with identical fingerprints.
 * @param accounts - All scraped accounts.
 * @returns Detection result with diagnostic message.
 */
function detectMirroredAccounts(accounts: readonly IMirrorAccount[]): IMirrorResult {
  if (accounts.length < 2) return { isMirrored: false, message: 'single-account' };
  const fingerprints = accounts.map(computeFingerprint);
  const uniqueCount = new Set(fingerprints).size;
  const totalCount = fingerprints.length;
  if (uniqueCount === totalCount) return { isMirrored: false, message: 'all-unique' };
  const dupCount = String(totalCount - uniqueCount + 1);
  const totalStr = String(totalCount);
  const msg = `MIRROR_SUSPECT: ${dupCount} of ${totalStr} accounts share fingerprint`;
  LOG.warn({ message: msg });
  return { isMirrored: true, message: msg };
}

export type { IMirrorResult };
export { detectMirroredAccounts };
