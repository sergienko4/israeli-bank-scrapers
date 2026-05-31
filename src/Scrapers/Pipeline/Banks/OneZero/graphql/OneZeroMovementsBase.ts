/**
 * OneZero GraphQL fragment strings — base fragments used inside GET_MOVEMENTS.
 * Data only. Kept separate to honour the per-file line limit.
 */

/** Instrument-amount fragment. */
const INSTRUMENT_AMOUNT = `
fragment TransactionInstrumentAmountFragment on TransactionInstrumentAmount {
  __typename
  instrumentAmount
  instrumentSymbol
  instrumentType
}`;

/** Counter-party reference fragment. */
const COUNTER_PARTY_REFERENCE = `
fragment CounterPartyReferenceFragment on CounterPartyReference {
  __typename
  bankId
  bic
  branchCode
  id
  name
  type
}`;

/** Base-transaction fragment. */
const BASE_TRANSACTION = `
fragment BaseTransactionFragment on BaseTransaction {
  __typename
  accountId
  betweenOwnAccounts
  bookDate
  calculatedStatus
  chargeAmount { __typename ...TransactionInstrumentAmountFragment }
  clearingSystem
  counterParty { __typename ...CounterPartyReferenceFragment }
  currentPaymentNumber
  direction
  domainType
  isReversal
  method
  originalAmount { __typename ...TransactionInstrumentAmountFragment }
  portfolioId
  totalPaymentsCount
  transactionId
  transactionType
  valueDate
}`;

/** Category + recurrence fragments (inside GET_MOVEMENTS). */
const CATEGORY_AND_RECURRENCE = `
fragment CategoryFragment on Category {
  __typename
  categoryId
  dataSource
  subCategoryId
}
fragment RecurrenceFragment on Recurrence {
  __typename
  dataSource
  isRecurrent
}`;

/** Transaction-enrichment fragment. */
const TRANSACTION_ENRICHMENT = `
fragment TransactionEnrichmentFragment on TransactionEnrichment {
  __typename
  categories { __typename ...CategoryFragment }
  recurrences { __typename ...RecurrenceFragment }
}`;

/** Transaction-event metadata fragment. */
const TRANSACTION_METADATA = `
fragment TransactionEventMetadataFragment on TransactionEventMetadata {
  __typename
  correlationId
  processingOrder
}`;

/** Counter-party transfer fragment. */
const COUNTER_PARTY_TRANSFER = `
fragment CounterPartyTransferData on CounterPartyTransfer {
  __typename
  accountId
  bank_id
  branch_code
  counter_party_name
}`;

export {
  BASE_TRANSACTION,
  CATEGORY_AND_RECURRENCE,
  COUNTER_PARTY_REFERENCE,
  COUNTER_PARTY_TRANSFER,
  INSTRUMENT_AMOUNT,
  TRANSACTION_ENRICHMENT,
  TRANSACTION_METADATA,
};
