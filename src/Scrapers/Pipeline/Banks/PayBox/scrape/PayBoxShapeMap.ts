/**
 * PayBox wallet-row → canonical {@link ITransaction} mapper. Split from
 * PayBoxShapeTxns.ts to keep both files under the 150-LOC ceiling. The
 * autoMapTransaction downstream drops rows whose field-names do not
 * match the canonical aliases; this mapper translates PayBox's
 * (`amt`, `ts` ISO, `merchantName`, `state`, …) into the canonical
 * shape so every row survives.
 */

import type { ITransaction } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';
import { findAllFieldValues } from '../../../Mediator/Scrape/BfsFieldSearch/BfsFieldSearch.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';

/** Raw wallet row returned by /getUserHistory `content.nc[i]`. */
export interface IWalletTxnRaw {
  readonly transactionId?: string;
  readonly _id?: string;
  readonly ts?: string;
  readonly type?: string;
  readonly subType?: string;
  readonly state?: string;
  readonly amt?: number;
  readonly transactionCurrency?: string;
  readonly merchantName?: string;
  readonly text?: string;
  readonly comment?: string;
  readonly userComment?: string;
  /**
   * PayBox sends more per-row fields than this contract models, and the
   * set varies by transaction kind (a peer transfer names its
   * counterparty somewhere other than `merchantName`). The index
   * signature keeps those rows readable by the canonical alias search in
   * {@link displayOf} without inventing field names we have not observed.
   */
  readonly [field: string]: unknown;
}

/** Wallet rows never split into installments — every row is `Normal`. */
const WALLET_TXN_TYPE = TransactionTypes.Normal;

/**
 * PayBox `type` values whose wallet effect is a debit (money leaves the
 * balance). Grounded in the app's own row model (`PbNotification`): the
 * Sent-tab classifier (`pay`, `groupBalanceUp`, `userBalanceDown`,
 * `withdrawCreated`) plus the wallet outflows a purchase, a completed
 * withdrawal, an external payment and a card tap represent. Every other
 * `type` is treated as a credit.
 */
const DEBIT_TYPES: ReadonlySet<string> = new Set([
  'pay',
  'purchase',
  'groupBalanceUp',
  'userBalanceDown',
  'withdrawCreated',
  'withdrawCompleted',
  'externalPayment',
  'tap',
]);

/**
 * `subType` values that force a credit regardless of `type` — interest
 * and loan income always add to the wallet balance.
 */
const CREDIT_SUBTYPES: ReadonlySet<string> = new Set(['interestIncome', 'loanIncome']);

/**
 * Decide whether a row debits the wallet. A credit `subType` wins over
 * the `type` table so interest / loan income is never mis-signed.
 * @param raw - Raw wallet row.
 * @returns True when the row reduces the wallet balance.
 */
function isDebit(raw: IWalletTxnRaw): boolean {
  const subType = typeof raw.subType === 'string' ? raw.subType : '';
  if (CREDIT_SUBTYPES.has(subType)) return false;
  const type = typeof raw.type === 'string' ? raw.type : '';
  return DEBIT_TYPES.has(type);
}

/**
 * Resolve the sign-adjusted amount. PayBox sends `amt` as an unsigned
 * magnitude — the app itself calls `Math.abs(amt)` and injects the sign
 * by `type` — so debit rows negate the magnitude and credit rows keep
 * it positive.
 * @param raw - Raw wallet row.
 * @returns Sign-adjusted amount.
 */
function signedAmount(raw: IWalletTxnRaw): number {
  const magnitude = typeof raw.amt === 'number' ? Math.abs(raw.amt) : 0;
  return isDebit(raw) ? -magnitude : magnitude;
}

/**
 * PayBox `state` (a `PurchaseStat`) mapped to canonical statuses. Real
 * values are `clearance` / `refund` (settled) and `filtered` /
 * `rejected` (not settled). Most non-purchase rows omit `state`
 * entirely and are settled history, so an absent value reads Completed.
 */
const STATE_STATUS: ReadonlyMap<string, TransactionStatuses> = new Map([
  ['clearance', TransactionStatuses.Completed],
  ['refund', TransactionStatuses.Completed],
  ['filtered', TransactionStatuses.Pending],
  ['rejected', TransactionStatuses.Pending],
]);

/**
 * Map PayBox's `state` field to the canonical {@link TransactionStatuses}.
 * Unknown or absent states default to Completed — a settled history row.
 * @param raw - Raw wallet row.
 * @returns Canonical status.
 */
export function statusOf(raw: IWalletTxnRaw): TransactionStatuses {
  const state = typeof raw.state === 'string' ? raw.state : '';
  return STATE_STATUS.get(state) ?? TransactionStatuses.Completed;
}

/**
 * Decode PayBox's `ts` (ISO-8601 string) into a canonical ISO date.
 * Invalid / missing values fall back to epoch so a single malformed
 * row never bubbles up as a `RangeError` from `toISOString`.
 * @param raw - Raw wallet row.
 * @returns ISO date string.
 */
function dateOf(raw: IWalletTxnRaw): string {
  const parsed = new Date(raw.ts ?? 0);
  const ms = parsed.getTime();
  const stamp = Number.isFinite(ms) ? parsed : new Date(0);
  return stamp.toISOString();
}

/** Bundle of consumer-visible fields decoded from PayBox's row shape. */
interface IDisplay {
  readonly description: string;
  readonly memo: string;
}

/**
 * Pick the first candidate carrying visible content.
 *
 * PayBox sends `''` as often as it omits a field, so `??` chains are
 * wrong here: `raw.merchantName ?? raw.text` never reaches `text` once
 * `merchantName` is present-but-empty, which left live rows with a blank
 * description. Blank means "absent" — the same rule
 * `TxnMapper.coerceIdentifier` already applies to sentinel identifiers.
 * @param candidates - Values in priority order.
 * @returns First trimmed-non-empty candidate, or `''` when all are blank.
 */
function firstNonBlank(candidates: readonly unknown[]): string {
  const hit = candidates.find((v): boolean => typeof v === 'string' && v.trim() !== '');
  return typeof hit === 'string' ? hit : '';
}

/**
 * Decide whether a value is a string carrying no visible content.
 * @param value - Candidate value.
 * @returns True only for an empty or whitespace-only string.
 */
function isBlankString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}

/**
 * Stable per-row identity. PayBox names it `transactionId` on some row
 * kinds and `_id` on others, and sends `''` rather than omitting the
 * field — so the blank-means-absent rule applies here too.
 * @param raw - Raw wallet row.
 * @returns Row identity, or `''` when the row carries none.
 */
function walletRowId(raw: IWalletTxnRaw): string {
  return firstNonBlank([raw.transactionId, raw._id]);
}

/**
 * Row copy with blank string values removed, so the canonical alias
 * search treats an empty `merchantName` as absent and keeps looking.
 *
 * Only blank STRINGS are dropped — nested records and arrays are kept,
 * because the alias search descends into them and a peer transfer names
 * its counterparty inside such a block.
 * @param raw - Raw wallet row.
 * @returns Row without its blank-valued keys.
 */
function withoutBlanks(raw: IWalletTxnRaw): Record<string, unknown> {
  const kept = Object.entries(raw).filter(([, v]): boolean => !isBlankString(v));
  return Object.fromEntries(kept);
}

/**
 * First non-blank value for one canonical alias, anywhere in the row.
 * @param searchable - Row with its top-level blanks already removed.
 * @param alias - Canonical field name to look for.
 * @returns Non-blank hit, or `''` when the alias yields none.
 */
function aliasHit(searchable: Record<string, unknown>, alias: string): string {
  const hits = findAllFieldValues(searchable, [alias]);
  return firstNonBlank(hits);
}

/**
 * Last-resort description lookup via the shared well-known alias search
 * — the same list every other bank resolves descriptions through. Used
 * only when PayBox's own two description fields are blank, so rows whose
 * counterparty lives under a different canonical alias still read.
 *
 * Searched one alias at a time, because the shared search returns a
 * single hit per record: a nested blank under a high-priority alias
 * would otherwise end the search and shadow a populated lower-priority
 * peer. {@link withoutBlanks} cannot prevent that — it only sees the top
 * level — so alias priority is re-applied here over non-blank hits only.
 * @param raw - Raw wallet row.
 * @returns First non-blank alias hit, or `''` when the row carries none.
 */
function aliasDescription(raw: IWalletTxnRaw): string {
  const searchable = withoutBlanks(raw);
  const perAlias = WK.description.map((alias): string => aliasHit(searchable, alias));
  return firstNonBlank(perAlias);
}

/**
 * Resolve canonical `description` / `memo` with PayBox's fallback chain.
 * @param raw - Raw wallet row.
 * @returns Display bundle (description + memo).
 */
function displayOf(raw: IWalletTxnRaw): IDisplay {
  const primary = firstNonBlank([raw.merchantName, raw.text]);
  const description = primary === '' ? aliasDescription(raw) : primary;
  return {
    description,
    memo: firstNonBlank([raw.comment, raw.userComment]),
  };
}

/** Bundle of money-related fields decoded from PayBox's row shape. */
interface IMoney {
  readonly chargedAmount: number;
  readonly originalAmount: number;
  readonly originalCurrency: string;
}

/**
 * Resolve canonical money fields. Sign convention is encoded by
 * `signedAmount`; currency defaults to ILS when absent.
 * @param raw - Raw wallet row.
 * @returns Money bundle.
 */
function moneyOf(raw: IWalletTxnRaw): IMoney {
  const amount = signedAmount(raw);
  return {
    chargedAmount: amount,
    originalAmount: amount,
    originalCurrency: raw.transactionCurrency ?? 'ILS',
  };
}

/**
 * Map one raw wallet row to the canonical ITransaction shape so
 * `autoMapTransaction` accepts it. PayBox's `ts` is an ISO-8601 string,
 * `amt` is an unsigned magnitude (sign derived from `type` / `subType`),
 * and `merchantName` carries the human-readable description.
 * @param raw - Raw row from `content.nc[i]`.
 * @returns Canonical transaction.
 */
export function mapWalletTxn(raw: IWalletTxnRaw): ITransaction {
  const date = dateOf(raw);
  return {
    identifier: walletRowId(raw),
    date,
    processedDate: date,
    ...displayOf(raw),
    ...moneyOf(raw),
    status: statusOf(raw),
    type: WALLET_TXN_TYPE,
  };
}
