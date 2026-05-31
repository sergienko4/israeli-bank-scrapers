/**
 * OneZero GraphQL fragment strings — transaction-details union + wrapper.
 * Data only. Kept separate to honour the per-file line limit.
 */

/** TransactionDetails union — composes all the detail unions. */
const TRANSACTION_DETAILS = `
fragment TransactionsDetailsData on TransactionDetails {
  __typename
  ... on BankTransfer {
    bank_transfer_details { __typename ...BankTransferDetailsData }
    book_date
    categories { __typename ...CategoryData }
    recurrences { __typename ...RecurrenceData }
    value_date
  }
  ... on Card {
    card_details { __typename ...CardDetailsData }
    categories { __typename ...CategoryData }
    recurrences { __typename ...RecurrenceData }
    value_date
  }
  ... on Cash {
    cash_details { __typename ...CashDetailsData }
    categories { __typename ...CategoryData }
    recurrences { __typename ...RecurrenceData }
    value_date
  }
  ... on Cheques {
    categories { __typename ...CategoryData }
    chequesDetails { __typename ...ChequesDetailsData }
    recurrences { __typename ...RecurrenceData }
    valueDate
    referenceNumber
    frontImageUrl
    backImageUrl
  }
  ... on Default {
    default_details { __typename ...DefaultDetailsData }
    recurrences { __typename ...RecurrenceData }
    value_date
  }
  ... on Fee {
    categories { __typename ...CategoryData }
    fee_details { __typename ...FeeDetailsData }
    value_date
  }
  ... on Loans {
    categories { __typename ...CategoryData }
    loan_details { __typename ...LoanDetailsData }
    recurrences { __typename ...RecurrenceData }
    value_date
  }
  ... on Mandate {
    categories { __typename ...CategoryData }
    mandate_details { __typename ...MandateDetailsData }
    recurrences { __typename ...RecurrenceData }
    value_date
  }
  ... on Savings {
    categories { __typename ...CategoryData }
    recurrences { __typename ...RecurrenceData }
    savings_details { __typename ...SavingsDetailsData }
    value_date
  }
  ... on SubscriptionTransaction {
    categories { __typename ...CategoryData }
    recurrences { __typename ...RecurrenceData }
    subscription_details { __typename ...SubscriptionDetailsData }
    value_date
  }
}`;

/** Transaction wrapper — references baseTransaction + enrichment + metadata. */
const TRANSACTION_WRAPPER = `
fragment TransactionFragment on Transaction {
  __typename
  baseTransaction { __typename ...BaseTransactionFragment }
  enrichment { __typename ...TransactionEnrichmentFragment }
  metadata { __typename ...TransactionEventMetadataFragment }
  referenceNumber
  transactionDetails { __typename ...TransactionsDetailsData }
}`;

export { TRANSACTION_DETAILS, TRANSACTION_WRAPPER };
