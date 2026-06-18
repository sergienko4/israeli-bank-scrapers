/**
 * Transaction field name mappings for auto-mapping responses.
 * Extracted from ScrapeWK.ts — SOLID single-responsibility for field dictionaries.
 */

// ID-field tuples are split into {@link ./ScrapeIdFields.js} to keep
// this module under the 150-line max-lines ceiling.
import { DISPLAY_ID_FIELDS, QUERY_ID_FIELDS } from './ScrapeIdFields.js';

/** WellKnown response status field names. */
export const PIPELINE_WELL_KNOWN_RESPONSE_FIELDS = {
  responseStatus: ['Status', 'status', 'HeaderStatus', 'responseStatus'],
} satisfies Record<string, string[]>;

/**
 * WellKnown ACCOUNT-side field mappings — owned by ACCOUNT-RESOLVE
 * and any SCRAPE caller that needs an account/card identifier.
 *
 * <p>Phase 7d split: every account-side field that was historically
 * grouped under {@link PIPELINE_WELL_KNOWN_TXN_FIELDS} lives here so
 * the two concerns no longer share a dictionary. ACCOUNT-RESOLVE
 * imports this constant; SCRAPE keeps using the TXN dictionary for
 * date/amount/description/etc.
 */
export const PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS = {
  /**
   * Container key names that hold an array of account-shape records
   * inside a discovered API response. Order matters for downstream
   * iteration: card-level containers come first because the pipeline
   * iterates per-card (POST replays carry card4Number, not
   * bankAccountUniqueId). VisaCal regressed when `bankAccounts`
   * was matched before `cards` — replays then targeted bank
   * accounts and returned 0 txns. Bank-account-level containers stay
   * last. `accountsItems` is Leumi's WCF `UC_SO_GetAccounts` container
   * (`{AccountsItems:[{AccountIndex,MaskedNumber,…}]}` after the
   * `jsonResp` envelope is unwrapped) — bank-account level, so it is
   * appended last. Matching is suffix-based (`key.endsWith(wkName)`),
   * and `accountsItems` is not a suffix of any other bank's key.
   */
  containers: ['cardsList', 'cards', 'accounts', 'bankAccounts', 'accountsItems'],
  /** Combined identifier list — query-style first, display-style second. */
  id: [...QUERY_ID_FIELDS, ...DISPLAY_ID_FIELDS],
  /** Display identifiers (last-4 / short forms shown on the card). */
  displayId: [...DISPLAY_ID_FIELDS],
  /** Query identifiers (long unique ids the API uses on POST bodies). */
  queryId: [...QUERY_ID_FIELDS],
} satisfies Record<string, readonly string[]>;

/** WellKnown transaction field name mappings — cross-bank BFS dictionary. */
export const PIPELINE_WELL_KNOWN_TXN_FIELDS = {
  date: [
    'OperationDate',
    'trnPurchaseDate',
    'fullPurchaseDate',
    'fullPurchaseDateOutbound',
    'purchaseDate',
    'purchaseDateOutbound',
    'fullPaymentDate',
    'paymentDate',
    'date',
    'transactionDate',
    'txnDate',
    'dateOfRegistration',
    'dateOfBusinessDay',
    'operationDate',
    'eventDate',
    'valueDate',
    'movementTimestamp',
    'bookingDate',
    'effectiveDate',
    // Leumi WCF `UC_SO_27_GetBusinessAccountTrx` rows carry the txn
    // date as `DateUTC` (ISO). Appended LAST so banks with an earlier
    // alias keep matching theirs first; only Leumi's rows (which have
    // no other WK.date alias) resolve to it. Without it autoMapTransaction
    // rejects every Leumi txn as empty-date. Exact case-insensitive match
    // so it never collides with `EffectiveDateUTC`/`AsOfDateUTC`.
    'DateUTC',
  ],
  processedDate: ['ValueDate', 'debCrdDate', 'processedDate', 'billingDate', 'settlementDate'],
  amount: [
    'OperationAmount',
    'trnAmt',
    'dealSum',
    'dealSumOutbound',
    'paymentSum',
    'paymentSumOutbound',
    'amount',
    'actualPaymentAmount',
    'chargedAmount',
    'transactionAmount',
    'ilsAmount',
    // Isracard `approvedTransactions` rows carry the billed amount under
    // `ilsBillingAmount`. Without this alias the auto-mapper falls back
    // to `creditAmount - debitAmount = 0` and the today-pending charge
    // surfaces with a phantom `0` amount (Phase F evidence 2026-05-13).
    'ilsBillingAmount',
    'eventAmount',
    'movementAmount',
  ],
  debitAmount: ['debitAmount', 'debit', 'chargeAmount'],
  creditAmount: ['creditAmount', 'credit', 'incomeAmount'],
  originalAmount: [
    'OperationAmount',
    'amtBeforeConvAndIndex',
    'originalAmount',
    'dealSumOutbound',
    'paymentSumOutbound',
    'billingAmount',
  ],
  description: [
    'OperationDescriptionToDisplay',
    'merchantName',
    'fullSupplierNameHeb',
    'fullSupplierNameOutbound',
    'businessName',
    'description',
    'transDesc',
    'memo',
    'activityDescription',
  ],
  identifier: [
    'OperationNumber',
    'trnIntId',
    'identifier',
    'id',
    'referenceNumber',
    'reference',
    'txnId',
    'confirmationNumber',
    'movementId',
    'transactionId',
    // Phase F additions (2026-05-13) — bank-specific per-txn unique IDs
    // surfaced by the cross-bank verification run. Every Israeli bank
    // emits a stable `Asmachta`-style ID; the auto-mapper just needed
    // the alias list to recognise them.
    'seqVoucherNumber', // Isracard / Amex — vouchers + approvals
    'voucherNumber', // Isracard / Amex — backup numeric ID
    'seqConfirmationNumber', // Isracard approvedTransactions — long-form ID
    'uid', // Max — base-X txn UID
    'arn', // Max — acquirer reference number
    'authorizationNumber', // Max — bank authorization id
    'Urn', // Discount — operation-record URN
    'runtimeReferenceId', // Max — runtimeReference.id top-level alias
    'ReferenceNumberLong', // Leumi — UC_SO_27 per-txn reference (numeric)
  ],
  currency: [
    'trnCurrencySymbol',
    'currency',
    'originalCurrency',
    'currencyCode',
    'originalCurrencyIso',
    'movementCurrency',
  ],
  balance: [
    'AccountBalance',
    'balance',
    'nextTotalDebit',
    'currentBalance',
    'totalDebit',
    'currentDebit',
    'currentBillingAmount',
    'balanceAmount',
    'withdrawableBalance',
    'runningBalance',
    'currentAccountBalance',
    'closingBalance',
  ],
  txnContainers: [
    'txnIsrael',
    'txnAbroad',
    'transactions',
    'txns',
    'movements',
    'pendingTransactions',
    'israelAbroadVouchersList',
  ],
  direction: ['creditDebit', 'direction', 'debitCreditIndicator'],
  voidIndicators: ['dealSumType'],
  voucherFields: ['voucherNumberRatz', 'voucherNumberRatzOutbound'],
  shekelAliases: ['שח', 'ש"ח', 'NIS', '₪'],
  fromDate: ['fromTransDate', 'fromDate', 'FromDate', 'startDate', 'retrievalStartDate'],
  toDate: ['toTransDate', 'toDate', 'ToDate', 'endDate', 'retrievalEndDate'],
} satisfies Record<string, string[]>;

export { PIPELINE_WELL_KNOWN_MONTHLY_FIELDS } from './ScrapeMonthlyFields.js';
export { DISPLAY_ID_FIELDS, QUERY_ID_FIELDS };
export type AccountContainerName = (typeof PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS.containers)[number];
