/**
 * WellKnown API endpoint patterns + transaction field mappings.
 * Used by NetworkDiscovery and GenericScrapeStrategy.
 * Separated from PipelineWellKnown.ts for max-lines compliance.
 */

// ── API endpoint URL patterns ─────────────────────────────────────────────────────

/** WellKnown API endpoint patterns — regex patterns for network discovery. */
export const PIPELINE_WELL_KNOWN_API = {
  accounts: [/userAccountsData/i, /account\/init/i, /account\/info/i],
  transactions: [/transactionsDetails/i, /filteredTransactions/i, /lastTransactions/i],
  balance: [/infoAndBalance/i, /dashboardBalances/i, /GetFrameStatus/i, /Frames.*api/i],
  auth: [/authentication\/login/i, /verification/i, /loginSuccess/i],
  pending: [/approvals/i, /getClearanceRequests/i, /FutureTransaction/i],
} satisfies Record<string, RegExp[]>;

// ── Transaction field name mappings ───────────────────────────────────────────────

const DISPLAY_ID_FIELDS = [
  'last4Digits',
  'AccountID',
  'accountNumber',
  'cardNumber',
  'bankAccountNum',
  'cardSuffix',
  'displayId',
  'cardLast4',
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
    'purchaseDate',
    'date',
    'transactionDate',
    'txnDate',
  ],
  processedDate: ['ValueDate', 'debCrdDate', 'processedDate', 'billingDate', 'settlementDate'],
  amount: [
    'OperationAmount',
    'trnAmt',
    'dealSum',
    'amount',
    'chargedAmount',
    'transactionAmount',
    'ilsAmount',
  ],
  originalAmount: [
    'OperationAmount',
    'amtBeforeConvAndIndex',
    'originalAmount',
    'dealSumOutbound',
    'billingAmount',
  ],
  description: [
    'OperationDescriptionToDisplay',
    'merchantName',
    'businessName',
    'description',
    'transDesc',
    'memo',
  ],
  identifier: [
    'OperationNumber',
    'trnIntId',
    'identifier',
    'id',
    'referenceNumber',
    'txnId',
    'confirmationNumber',
  ],
  currency: [
    'trnCurrencySymbol',
    'currency',
    'originalCurrency',
    'currencyCode',
    'originalCurrencyIso',
  ],
  balance: ['AccountBalance', 'balance', 'nextTotalDebit', 'currentBalance'],
  fromDate: ['fromTransDate', 'fromDate', 'FromDate', 'startDate'],
  toDate: ['toTransDate', 'toDate', 'ToDate', 'endDate'],
} satisfies Record<string, string[]>;

/** WellKnown monthly iteration field names. */
export const PIPELINE_WELL_KNOWN_MONTHLY_FIELDS = {
  month: ['month', 'billingMonth', 'Month'],
  year: ['year', 'billingYear', 'Year'],
  /** Composite date fields — contain full DD/MM/YYYY string, not just month number. */
  compositeDate: ['billingMonth', 'BillingMonth', 'billingDate', 'BillingDate'],
  accountId: [
    'cardUniqueId',
    'cardUniqueID',
    'bankAccountUniqueID',
    'accountId',
    'cardNumber',
    'CardId',
    'card4Number',
  ],
} satisfies Record<string, string[]>;
