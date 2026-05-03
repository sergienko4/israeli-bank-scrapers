/**
 * Transaction field name mappings for auto-mapping responses.
 * Extracted from ScrapeWK.ts — SOLID single-responsibility for field dictionaries.
 */

/**
 * Display-id field ordering matters: card-suffix-like fields (4-digit
 * card identifiers used as POST body params on the card-family banks)
 * come BEFORE bank-account-number fields. Otherwise findFieldValue
 * matches `accountNumber` (e.g. "228812") on a card record that ALSO
 * carries `cardSuffix` ("8912"), and per-card POST replays would build
 * `card4Number=228812` — too long for the card-family API. Generic
 * ordering rule: short, 4-digit card identifiers first; long bank
 * account identifiers second.
 */
const DISPLAY_ID_FIELDS = [
  'last4Digits',
  'cardSuffix',
  'cardLast4',
  'shortCardNumber',
  'AccountID',
  'accountNumber',
  'cardNumber',
  'bankAccountNum',
  'displayId',
  'account',
] as const;

const QUERY_ID_FIELDS = [
  'cardUniqueId',
  'cardUniqueID',
  'bankAccountUniqueID',
  'accountId',
  'CardId',
  'cardIndex',
] as const;

/** WellKnown response status field names. */
export const PIPELINE_WELL_KNOWN_RESPONSE_FIELDS = {
  responseStatus: ['Status', 'status', 'HeaderStatus', 'responseStatus'],
} satisfies Record<string, string[]>;

/** WellKnown transaction field name mappings — cross-bank BFS dictionary. */
export const PIPELINE_WELL_KNOWN_TXN_FIELDS = {
  accountId: [...QUERY_ID_FIELDS, ...DISPLAY_ID_FIELDS],
  displayId: [...DISPLAY_ID_FIELDS],
  queryId: [...QUERY_ID_FIELDS],
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
  // Order matters: card-level containers come first because the
  // pipeline iterates per-card (POST replays carry card4Number, not
  // bankAccountUniqueId). VisaCal regressed when `bankAccounts` was
  // matched before `cards` — replays then targeted bank accounts and
  // returned 0 txns. Bank-account-level containers stay last.
  accountContainers: ['cardsList', 'cards', 'accounts', 'bankAccounts'],
  direction: ['creditDebit', 'direction', 'debitCreditIndicator'],
  voidIndicators: ['dealSumType'],
  voucherFields: ['voucherNumberRatz', 'voucherNumberRatzOutbound'],
  shekelAliases: ['שח', 'ש"ח', 'NIS', '₪'],
  fromDate: ['fromTransDate', 'fromDate', 'FromDate', 'startDate', 'retrievalStartDate'],
  toDate: ['toTransDate', 'toDate', 'ToDate', 'endDate', 'retrievalEndDate'],
} satisfies Record<string, string[]>;

export { PIPELINE_WELL_KNOWN_MONTHLY_FIELDS } from './ScrapeMonthlyFields.js';
export { DISPLAY_ID_FIELDS, QUERY_ID_FIELDS };
