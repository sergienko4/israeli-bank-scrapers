/**
 * Transaction field name mappings for auto-mapping responses.
 * Extracted from ScrapeWK.ts — SOLID single-responsibility for field dictionaries.
 */

const DISPLAY_ID_FIELDS = [
  'last4Digits',
  'AccountID',
  'accountNumber',
  'cardNumber',
  'bankAccountNum',
  'cardSuffix',
  'shortCardNumber',
  'displayId',
  'cardLast4',
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
