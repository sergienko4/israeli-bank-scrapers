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
  const sorted = [...canonicals].sort();
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
