/**
 * Transaction field name mappings for auto-mapping responses.
 * Extracted from ScrapeWK.ts — SOLID single-responsibility for field dictionaries.
 */

// Provider-annotation aliases (memo/category/chargedCurrency) are split into
// {@link ./ScrapeProviderFields.js} for the same reason.
import PROVIDER_ANNOTATION_FIELDS from './ScrapeProviderFields.js';
// Transaction-identifier aliases are split into
// {@link ./ScrapeTxnIdentifierFields.js} for the same reason.
import TXN_IDENTIFIER_FIELDS from './ScrapeTxnIdentifierFields.js';

/** WellKnown transaction field name mappings — cross-bank BFS dictionary.
 *
 * <p>Each `bancs*` alias is PREPENDED (matching is alias-first — see
 * `BfsFieldSearch.Match.matchField`) so a record flattened by
 * {@link "../../Mediator/Scrape/Bancs/BancsNormalizer.js"} deterministically
 * resolves to its computed flat field. This is a provable no-op for every
 * other bank: no non-BaNCS record carries a `bancs*` key, so the alias fails
 * to match and resolution falls straight through to the existing aliases. */
const PIPELINE_WELL_KNOWN_TXN_FIELDS = {
  date: [
    'bancsDate',
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
    // Mizrahi `SkyOSH/get428Index` rows. Every `MC02*` key is Mizrahi-only,
    // so appending it last changes no other bank's match.
    'MC02PeulaTaaEZ',
  ],
  processedDate: [
    'bancsProcessedDate',
    'ValueDate',
    'debCrdDate',
    'processedDate',
    'billingDate',
    'settlementDate',
    'MC02ErehTaaEZ', // Mizrahi value date (see `date`)
  ],
  amount: [
    'bancsAmount',
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
    'MC02SchumEZ', // Mizrahi signed amount (see `date`)
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
    'bancsDescription',
    'OperationDescriptionToDisplay',
    'merchantName',
    'fullSupplierNameHeb',
    'fullSupplierNameOutbound',
    'businessName',
    'description',
    'transDesc',
    'memo',
    'activityDescription',
    'MC02TnuaTeurEZ', // Mizrahi description (see `date`)
  ],
  identifier: [...TXN_IDENTIFIER_FIELDS],
  currency: [
    'bancsCurrency',
    'trnCurrencySymbol',
    'currency',
    // Amex/Isracard DigitalV3 — ISO-4217 text must win over the sibling
    // `originalCurrency`, which carries a numeric enum (0=ILS, 19=USD,
    // 100=EUR) on the same row. See issue #614.
    'originalCurrencyIso',
    'originalCurrency',
    'currencyCode',
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
  ...PROVIDER_ANNOTATION_FIELDS,
  voidIndicators: ['dealSumType'],
  voucherFields: ['voucherNumberRatz', 'voucherNumberRatzOutbound'],
  shekelAliases: ['שח', 'ש"ח', 'NIS', '₪'],
  fromDate: ['fromTransDate', 'fromDate', 'FromDate', 'startDate', 'retrievalStartDate'],
  toDate: ['toTransDate', 'toDate', 'ToDate', 'endDate', 'retrievalEndDate'],
} satisfies Record<string, string[]>;

export default PIPELINE_WELL_KNOWN_TXN_FIELDS;
