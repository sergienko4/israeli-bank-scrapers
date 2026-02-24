"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GET_MOVEMENTS = exports.GET_CUSTOMER = void 0;
const GET_CUSTOMER = exports.GET_CUSTOMER = `
query GetCustomer {
  customer {
    __typename
    customerId
    userId
    idType
    idNumber
    hebrewFirstName
    hebrewLastName
    latinFirstName
    latinLastName
    dateOfBirth
    lastLoginDate
    userEmail
    gender
    portfolioRelations {
      __typename
      customerId
      customerRole
      portfolioId
      initiator
      relationToInitiator
      status
    }
    portfolios {
      __typename
      ...Portfolio
    }
    status
  }
}
fragment Portfolio on Portfolio {
  __typename
  accounts {
    __typename
    accountId
    accountType
    closingDate
    currency
    openingDate
    status
    subType
  }
  activationDate
  bank
  baseCurrency
  branch
  club
  clubDescription
  iban
  imageURL
  isJointAccount
  partnerName {
    __typename
    partnerFirstName
    partnerLastName
  }
  portfolioId
  portfolioNum
  portfolioType
  status
  subType
  onboardingCompleted
}
`;
const GET_MOVEMENTS = exports.GET_MOVEMENTS = `query GetMovements(
  $portfolioId: String!
  $accountId: String!
  $pagination: PaginationInput!
  $language: BffLanguage!
) {
  movements(
    portfolioId: $portfolioId
    accountId: $accountId
    pagination: $pagination
    language: $language
  ) {
    __typename
    ...MovementsFragment
  }
}
fragment TransactionInstrumentAmountFragment on TransactionInstrumentAmount {
  __typename
  instrumentAmount
  instrumentSymbol
  instrumentType
}
fragment CounterPartyReferenceFragment on CounterPartyReference {
  __typename
  bankId
  bic
  branchCode
  id
  name
  type
}
fragment BaseTransactionFragment on BaseTransaction {
  __typename
  accountId
  betweenOwnAccounts
  bookDate
  calculatedStatus
  chargeAmount {
    __typename
    ...TransactionInstrumentAmountFragment
  }
  clearingSystem
  counterParty {
    __typename
    ...CounterPartyReferenceFragment
  }
  currentPaymentNumber
  direction
  domainType
  isReversal
  method
  originalAmount {
    __typename
    ...TransactionInstrumentAmountFragment
  }
  portfolioId
  totalPaymentsCount
  transactionId
  transactionType
  valueDate
}
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
}
fragment TransactionEnrichmentFragment on TransactionEnrichment {
  __typename
  categories {
    __typename
    ...CategoryFragment
  }
  recurrences {
    __typename
    ...RecurrenceFragment
  }
}
fragment TransactionEventMetadataFragment on TransactionEventMetadata {
  __typename
  correlationId
  processingOrder
}
fragment CounterPartyTransferData on CounterPartyTransfer {
  __typename
  accountId
  bank_id
  branch_code
  counter_party_name
}
fragment BankTransferDetailsData on BankTransferDetails {
  __typename
  ... on CashBlockTransfer {
    counterParty {
      __typename
      ...CounterPartyTransferData
    }
    transferDescriptionKey
  }
  ... on RTGSReturnTransfer {
    transferDescriptionKey
  }
  ... on RTGSTransfer {
    transferDescriptionKey
  }
  ... on SwiftReturnTransfer {
    transferConversionRate
    transferDescriptionKey
  }
  ... on SwiftTransfer {
    transferConversionRate
    transferDescriptionKey
  }
  ... on Transfer {
    counterParty {
      __typename
      ...CounterPartyTransferData
    }
    transferDescriptionKey
  }
}
fragment CategoryData on Category {
  __typename
  categoryId
  dataSource
  subCategoryId
}
fragment RecurrenceData on Recurrence {
  __typename
  dataSource
  isRecurrent
}
fragment CardDetailsData on CardDetails {
  __typename
  ... on CardCharge {
    book_date
    cardDescriptionKey
  }
  ... on CardChargeFCY {
    book_date
    cardConversionRate
    cardDescriptionKey
    cardFCYAmount
    cardFCYCurrency
  }
  ... on CardMonthlySettlement {
    cardDescriptionKey
  }
  ... on CardRefund {
    cardDescriptionKey
  }
  ... on CashBlockCardCharge {
    cardDescriptionKey
  }
}
fragment CashDetailsData on CashDetails {
  __typename
  ... on CashWithdrawal {
    cashDescriptionKey
  }
  ... on CashWithdrawalFCY {
    FCYAmount
    FCYCurrency
    cashDescriptionKey
    conversionRate
  }
}
fragment ChequesDetailsData on ChequesDetails {
  __typename
  ... on CashBlockChequeDeposit {
    bookDate
    chequesDescriptionKey
  }
  ... on ChequeDeposit {
    bookDate
    chequesDescriptionKey
  }
  ... on ChequeReturn {
    bookDate
    chequeReturnReason
    chequesDescriptionKey
  }
  ... on ChequeWithdrawal {
    chequesDescriptionKey
  }
}
fragment DefaultDetailsData on DefaultDetails {
  __typename
  ... on DefaultWithTransaction {
    defaultDescriptionKey
  }
  ... on DefaultWithoutTransaction {
    categories {
      __typename
      ...CategoryData
    }
    defaultDescriptionKey
  }
}
fragment FeeDetailsData on FeeDetails {
  __typename
  ... on GeneralFee {
    feeDescriptionKey
  }
}
fragment LoanDetailsData on LoanDetails {
  __typename
  ... on FullPrePayment {
    loanDescriptionKey
  }
  ... on Initiate {
    loanDescriptionKey
  }
  ... on MonthlyPayment {
    loanDescriptionKey
    loanPaymentNumber
    loanTotalPaymentsCount
  }
  ... on PartialPrePayment {
    loanDescriptionKey
  }
}
fragment MandateDetailsData on MandateDetails {
  __typename
  ... on MandatePayment {
    mandateDescriptionKey
  }
  ... on MandateReturnPayment {
    mandateDescriptionKey
  }
}
fragment SavingsDetailsData on SavingsDetails {
  __typename
  ... on FullSavingsWithdrawal {
    savingsDescriptionKey
  }
  ... on MonthlySavingsDeposit {
    savingsDepositNumber
    savingsDescriptionKey
    savingsTotalDepositCount
  }
  ... on PartialSavingsWithdrawal {
    savingsDescriptionKey
  }
  ... on SavingsClosing {
    savingsDescriptionKey
  }
  ... on SavingsDeposit {
    savingsDescriptionKey
  }
  ... on SavingsInterest {
    savingsDescriptionKey
  }
  ... on SavingsPenalty {
    savingsDescriptionKey
  }
  ... on SavingsTax {
    savingsDescriptionKey
  }
}
fragment SubscriptionDetailsData on SubscriptionDetails {
  __typename
  ... on SubscriptionPayment {
    subscriptionDescriptionKey
  }
  ... on SubscriptionReturnPayment {
    subscriptionDescriptionKey
  }
}
fragment TransactionsDetailsData on TransactionDetails {
  __typename
  ... on BankTransfer {
    bank_transfer_details {
      __typename
      ...BankTransferDetailsData
    }
    book_date
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Card {
    card_details {
      __typename
      ...CardDetailsData
    }
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Cash {
    cash_details {
      __typename
      ...CashDetailsData
    }
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Cheques {
    categories {
      __typename
      ...CategoryData
    }
    chequesDetails {
      __typename
      ...ChequesDetailsData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    valueDate
    referenceNumber
    frontImageUrl
    backImageUrl
  }
  ... on Default {
    default_details {
      __typename
      ...DefaultDetailsData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Fee {
    categories {
      __typename
      ...CategoryData
    }
    fee_details {
      __typename
      ...FeeDetailsData
    }
    value_date
  }
  ... on Loans {
    categories {
      __typename
      ...CategoryData
    }
    loan_details {
      __typename
      ...LoanDetailsData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Mandate {
    categories {
      __typename
      ...CategoryData
    }
    mandate_details {
      __typename
      ...MandateDetailsData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Savings {
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    savings_details {
      __typename
      ...SavingsDetailsData
    }
    value_date
  }
  ... on SubscriptionTransaction {
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    subscription_details {
      __typename
      ...SubscriptionDetailsData
    }
    value_date
  }
}
fragment TransactionFragment on Transaction {
  __typename
  baseTransaction {
    __typename
    ...BaseTransactionFragment
  }
  enrichment {
    __typename
    ...TransactionEnrichmentFragment
  }
  metadata {
    __typename
    ...TransactionEventMetadataFragment
  }
  referenceNumber
  transactionDetails {
    __typename
    ...TransactionsDetailsData
  }
}
fragment MovementFragment on Movement {
  __typename
  accountId
  bankCurrencyAmount
  bookingDate
  conversionRate
  creditDebit
  description
  isReversed
  linkTransaction {
    __typename
    ...TransactionFragment
  }
  movementAmount
  movementCurrency
  movementId
  movementReversedId
  movementTimestamp
  movementType
  portfolioId
  runningBalance
  transaction {
    __typename
    ...TransactionFragment
  }
  valueDate
}
fragment PaginationFragment on Pagination {
  __typename
  cursor
  hasMore
}
fragment MovementsFragment on Movements {
  __typename
  isRunningBalanceInSync
  movements {
    __typename
    ...MovementFragment
  }
  pagination {
    __typename
    ...PaginationFragment
  }
}`;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJHRVRfQ1VTVE9NRVIiLCJleHBvcnRzIiwiR0VUX01PVkVNRU5UUyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9vbmUtemVyby1xdWVyaWVzLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBHRVRfQ1VTVE9NRVIgPSBgXHJcbnF1ZXJ5IEdldEN1c3RvbWVyIHtcclxuICBjdXN0b21lciB7XHJcbiAgICBfX3R5cGVuYW1lXHJcbiAgICBjdXN0b21lcklkXHJcbiAgICB1c2VySWRcclxuICAgIGlkVHlwZVxyXG4gICAgaWROdW1iZXJcclxuICAgIGhlYnJld0ZpcnN0TmFtZVxyXG4gICAgaGVicmV3TGFzdE5hbWVcclxuICAgIGxhdGluRmlyc3ROYW1lXHJcbiAgICBsYXRpbkxhc3ROYW1lXHJcbiAgICBkYXRlT2ZCaXJ0aFxyXG4gICAgbGFzdExvZ2luRGF0ZVxyXG4gICAgdXNlckVtYWlsXHJcbiAgICBnZW5kZXJcclxuICAgIHBvcnRmb2xpb1JlbGF0aW9ucyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgY3VzdG9tZXJJZFxyXG4gICAgICBjdXN0b21lclJvbGVcclxuICAgICAgcG9ydGZvbGlvSWRcclxuICAgICAgaW5pdGlhdG9yXHJcbiAgICAgIHJlbGF0aW9uVG9Jbml0aWF0b3JcclxuICAgICAgc3RhdHVzXHJcbiAgICB9XHJcbiAgICBwb3J0Zm9saW9zIHtcclxuICAgICAgX190eXBlbmFtZVxyXG4gICAgICAuLi5Qb3J0Zm9saW9cclxuICAgIH1cclxuICAgIHN0YXR1c1xyXG4gIH1cclxufVxyXG5mcmFnbWVudCBQb3J0Zm9saW8gb24gUG9ydGZvbGlvIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgYWNjb3VudHMge1xyXG4gICAgX190eXBlbmFtZVxyXG4gICAgYWNjb3VudElkXHJcbiAgICBhY2NvdW50VHlwZVxyXG4gICAgY2xvc2luZ0RhdGVcclxuICAgIGN1cnJlbmN5XHJcbiAgICBvcGVuaW5nRGF0ZVxyXG4gICAgc3RhdHVzXHJcbiAgICBzdWJUeXBlXHJcbiAgfVxyXG4gIGFjdGl2YXRpb25EYXRlXHJcbiAgYmFua1xyXG4gIGJhc2VDdXJyZW5jeVxyXG4gIGJyYW5jaFxyXG4gIGNsdWJcclxuICBjbHViRGVzY3JpcHRpb25cclxuICBpYmFuXHJcbiAgaW1hZ2VVUkxcclxuICBpc0pvaW50QWNjb3VudFxyXG4gIHBhcnRuZXJOYW1lIHtcclxuICAgIF9fdHlwZW5hbWVcclxuICAgIHBhcnRuZXJGaXJzdE5hbWVcclxuICAgIHBhcnRuZXJMYXN0TmFtZVxyXG4gIH1cclxuICBwb3J0Zm9saW9JZFxyXG4gIHBvcnRmb2xpb051bVxyXG4gIHBvcnRmb2xpb1R5cGVcclxuICBzdGF0dXNcclxuICBzdWJUeXBlXHJcbiAgb25ib2FyZGluZ0NvbXBsZXRlZFxyXG59XHJcbmA7XHJcblxyXG5leHBvcnQgY29uc3QgR0VUX01PVkVNRU5UUyA9IGBxdWVyeSBHZXRNb3ZlbWVudHMoXHJcbiAgJHBvcnRmb2xpb0lkOiBTdHJpbmchXHJcbiAgJGFjY291bnRJZDogU3RyaW5nIVxyXG4gICRwYWdpbmF0aW9uOiBQYWdpbmF0aW9uSW5wdXQhXHJcbiAgJGxhbmd1YWdlOiBCZmZMYW5ndWFnZSFcclxuKSB7XHJcbiAgbW92ZW1lbnRzKFxyXG4gICAgcG9ydGZvbGlvSWQ6ICRwb3J0Zm9saW9JZFxyXG4gICAgYWNjb3VudElkOiAkYWNjb3VudElkXHJcbiAgICBwYWdpbmF0aW9uOiAkcGFnaW5hdGlvblxyXG4gICAgbGFuZ3VhZ2U6ICRsYW5ndWFnZVxyXG4gICkge1xyXG4gICAgX190eXBlbmFtZVxyXG4gICAgLi4uTW92ZW1lbnRzRnJhZ21lbnRcclxuICB9XHJcbn1cclxuZnJhZ21lbnQgVHJhbnNhY3Rpb25JbnN0cnVtZW50QW1vdW50RnJhZ21lbnQgb24gVHJhbnNhY3Rpb25JbnN0cnVtZW50QW1vdW50IHtcclxuICBfX3R5cGVuYW1lXHJcbiAgaW5zdHJ1bWVudEFtb3VudFxyXG4gIGluc3RydW1lbnRTeW1ib2xcclxuICBpbnN0cnVtZW50VHlwZVxyXG59XHJcbmZyYWdtZW50IENvdW50ZXJQYXJ0eVJlZmVyZW5jZUZyYWdtZW50IG9uIENvdW50ZXJQYXJ0eVJlZmVyZW5jZSB7XHJcbiAgX190eXBlbmFtZVxyXG4gIGJhbmtJZFxyXG4gIGJpY1xyXG4gIGJyYW5jaENvZGVcclxuICBpZFxyXG4gIG5hbWVcclxuICB0eXBlXHJcbn1cclxuZnJhZ21lbnQgQmFzZVRyYW5zYWN0aW9uRnJhZ21lbnQgb24gQmFzZVRyYW5zYWN0aW9uIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgYWNjb3VudElkXHJcbiAgYmV0d2Vlbk93bkFjY291bnRzXHJcbiAgYm9va0RhdGVcclxuICBjYWxjdWxhdGVkU3RhdHVzXHJcbiAgY2hhcmdlQW1vdW50IHtcclxuICAgIF9fdHlwZW5hbWVcclxuICAgIC4uLlRyYW5zYWN0aW9uSW5zdHJ1bWVudEFtb3VudEZyYWdtZW50XHJcbiAgfVxyXG4gIGNsZWFyaW5nU3lzdGVtXHJcbiAgY291bnRlclBhcnR5IHtcclxuICAgIF9fdHlwZW5hbWVcclxuICAgIC4uLkNvdW50ZXJQYXJ0eVJlZmVyZW5jZUZyYWdtZW50XHJcbiAgfVxyXG4gIGN1cnJlbnRQYXltZW50TnVtYmVyXHJcbiAgZGlyZWN0aW9uXHJcbiAgZG9tYWluVHlwZVxyXG4gIGlzUmV2ZXJzYWxcclxuICBtZXRob2RcclxuICBvcmlnaW5hbEFtb3VudCB7XHJcbiAgICBfX3R5cGVuYW1lXHJcbiAgICAuLi5UcmFuc2FjdGlvbkluc3RydW1lbnRBbW91bnRGcmFnbWVudFxyXG4gIH1cclxuICBwb3J0Zm9saW9JZFxyXG4gIHRvdGFsUGF5bWVudHNDb3VudFxyXG4gIHRyYW5zYWN0aW9uSWRcclxuICB0cmFuc2FjdGlvblR5cGVcclxuICB2YWx1ZURhdGVcclxufVxyXG5mcmFnbWVudCBDYXRlZ29yeUZyYWdtZW50IG9uIENhdGVnb3J5IHtcclxuICBfX3R5cGVuYW1lXHJcbiAgY2F0ZWdvcnlJZFxyXG4gIGRhdGFTb3VyY2VcclxuICBzdWJDYXRlZ29yeUlkXHJcbn1cclxuZnJhZ21lbnQgUmVjdXJyZW5jZUZyYWdtZW50IG9uIFJlY3VycmVuY2Uge1xyXG4gIF9fdHlwZW5hbWVcclxuICBkYXRhU291cmNlXHJcbiAgaXNSZWN1cnJlbnRcclxufVxyXG5mcmFnbWVudCBUcmFuc2FjdGlvbkVucmljaG1lbnRGcmFnbWVudCBvbiBUcmFuc2FjdGlvbkVucmljaG1lbnQge1xyXG4gIF9fdHlwZW5hbWVcclxuICBjYXRlZ29yaWVzIHtcclxuICAgIF9fdHlwZW5hbWVcclxuICAgIC4uLkNhdGVnb3J5RnJhZ21lbnRcclxuICB9XHJcbiAgcmVjdXJyZW5jZXMge1xyXG4gICAgX190eXBlbmFtZVxyXG4gICAgLi4uUmVjdXJyZW5jZUZyYWdtZW50XHJcbiAgfVxyXG59XHJcbmZyYWdtZW50IFRyYW5zYWN0aW9uRXZlbnRNZXRhZGF0YUZyYWdtZW50IG9uIFRyYW5zYWN0aW9uRXZlbnRNZXRhZGF0YSB7XHJcbiAgX190eXBlbmFtZVxyXG4gIGNvcnJlbGF0aW9uSWRcclxuICBwcm9jZXNzaW5nT3JkZXJcclxufVxyXG5mcmFnbWVudCBDb3VudGVyUGFydHlUcmFuc2ZlckRhdGEgb24gQ291bnRlclBhcnR5VHJhbnNmZXIge1xyXG4gIF9fdHlwZW5hbWVcclxuICBhY2NvdW50SWRcclxuICBiYW5rX2lkXHJcbiAgYnJhbmNoX2NvZGVcclxuICBjb3VudGVyX3BhcnR5X25hbWVcclxufVxyXG5mcmFnbWVudCBCYW5rVHJhbnNmZXJEZXRhaWxzRGF0YSBvbiBCYW5rVHJhbnNmZXJEZXRhaWxzIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgLi4uIG9uIENhc2hCbG9ja1RyYW5zZmVyIHtcclxuICAgIGNvdW50ZXJQYXJ0eSB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uQ291bnRlclBhcnR5VHJhbnNmZXJEYXRhXHJcbiAgICB9XHJcbiAgICB0cmFuc2ZlckRlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG4gIC4uLiBvbiBSVEdTUmV0dXJuVHJhbnNmZXIge1xyXG4gICAgdHJhbnNmZXJEZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gUlRHU1RyYW5zZmVyIHtcclxuICAgIHRyYW5zZmVyRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbiAgLi4uIG9uIFN3aWZ0UmV0dXJuVHJhbnNmZXIge1xyXG4gICAgdHJhbnNmZXJDb252ZXJzaW9uUmF0ZVxyXG4gICAgdHJhbnNmZXJEZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gU3dpZnRUcmFuc2ZlciB7XHJcbiAgICB0cmFuc2ZlckNvbnZlcnNpb25SYXRlXHJcbiAgICB0cmFuc2ZlckRlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG4gIC4uLiBvbiBUcmFuc2ZlciB7XHJcbiAgICBjb3VudGVyUGFydHkge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLkNvdW50ZXJQYXJ0eVRyYW5zZmVyRGF0YVxyXG4gICAgfVxyXG4gICAgdHJhbnNmZXJEZXNjcmlwdGlvbktleVxyXG4gIH1cclxufVxyXG5mcmFnbWVudCBDYXRlZ29yeURhdGEgb24gQ2F0ZWdvcnkge1xyXG4gIF9fdHlwZW5hbWVcclxuICBjYXRlZ29yeUlkXHJcbiAgZGF0YVNvdXJjZVxyXG4gIHN1YkNhdGVnb3J5SWRcclxufVxyXG5mcmFnbWVudCBSZWN1cnJlbmNlRGF0YSBvbiBSZWN1cnJlbmNlIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgZGF0YVNvdXJjZVxyXG4gIGlzUmVjdXJyZW50XHJcbn1cclxuZnJhZ21lbnQgQ2FyZERldGFpbHNEYXRhIG9uIENhcmREZXRhaWxzIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgLi4uIG9uIENhcmRDaGFyZ2Uge1xyXG4gICAgYm9va19kYXRlXHJcbiAgICBjYXJkRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbiAgLi4uIG9uIENhcmRDaGFyZ2VGQ1kge1xyXG4gICAgYm9va19kYXRlXHJcbiAgICBjYXJkQ29udmVyc2lvblJhdGVcclxuICAgIGNhcmREZXNjcmlwdGlvbktleVxyXG4gICAgY2FyZEZDWUFtb3VudFxyXG4gICAgY2FyZEZDWUN1cnJlbmN5XHJcbiAgfVxyXG4gIC4uLiBvbiBDYXJkTW9udGhseVNldHRsZW1lbnQge1xyXG4gICAgY2FyZERlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG4gIC4uLiBvbiBDYXJkUmVmdW5kIHtcclxuICAgIGNhcmREZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gQ2FzaEJsb2NrQ2FyZENoYXJnZSB7XHJcbiAgICBjYXJkRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbn1cclxuZnJhZ21lbnQgQ2FzaERldGFpbHNEYXRhIG9uIENhc2hEZXRhaWxzIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgLi4uIG9uIENhc2hXaXRoZHJhd2FsIHtcclxuICAgIGNhc2hEZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gQ2FzaFdpdGhkcmF3YWxGQ1kge1xyXG4gICAgRkNZQW1vdW50XHJcbiAgICBGQ1lDdXJyZW5jeVxyXG4gICAgY2FzaERlc2NyaXB0aW9uS2V5XHJcbiAgICBjb252ZXJzaW9uUmF0ZVxyXG4gIH1cclxufVxyXG5mcmFnbWVudCBDaGVxdWVzRGV0YWlsc0RhdGEgb24gQ2hlcXVlc0RldGFpbHMge1xyXG4gIF9fdHlwZW5hbWVcclxuICAuLi4gb24gQ2FzaEJsb2NrQ2hlcXVlRGVwb3NpdCB7XHJcbiAgICBib29rRGF0ZVxyXG4gICAgY2hlcXVlc0Rlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG4gIC4uLiBvbiBDaGVxdWVEZXBvc2l0IHtcclxuICAgIGJvb2tEYXRlXHJcbiAgICBjaGVxdWVzRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbiAgLi4uIG9uIENoZXF1ZVJldHVybiB7XHJcbiAgICBib29rRGF0ZVxyXG4gICAgY2hlcXVlUmV0dXJuUmVhc29uXHJcbiAgICBjaGVxdWVzRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbiAgLi4uIG9uIENoZXF1ZVdpdGhkcmF3YWwge1xyXG4gICAgY2hlcXVlc0Rlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG59XHJcbmZyYWdtZW50IERlZmF1bHREZXRhaWxzRGF0YSBvbiBEZWZhdWx0RGV0YWlscyB7XHJcbiAgX190eXBlbmFtZVxyXG4gIC4uLiBvbiBEZWZhdWx0V2l0aFRyYW5zYWN0aW9uIHtcclxuICAgIGRlZmF1bHREZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gRGVmYXVsdFdpdGhvdXRUcmFuc2FjdGlvbiB7XHJcbiAgICBjYXRlZ29yaWVzIHtcclxuICAgICAgX190eXBlbmFtZVxyXG4gICAgICAuLi5DYXRlZ29yeURhdGFcclxuICAgIH1cclxuICAgIGRlZmF1bHREZXNjcmlwdGlvbktleVxyXG4gIH1cclxufVxyXG5mcmFnbWVudCBGZWVEZXRhaWxzRGF0YSBvbiBGZWVEZXRhaWxzIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgLi4uIG9uIEdlbmVyYWxGZWUge1xyXG4gICAgZmVlRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbn1cclxuZnJhZ21lbnQgTG9hbkRldGFpbHNEYXRhIG9uIExvYW5EZXRhaWxzIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgLi4uIG9uIEZ1bGxQcmVQYXltZW50IHtcclxuICAgIGxvYW5EZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gSW5pdGlhdGUge1xyXG4gICAgbG9hbkRlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG4gIC4uLiBvbiBNb250aGx5UGF5bWVudCB7XHJcbiAgICBsb2FuRGVzY3JpcHRpb25LZXlcclxuICAgIGxvYW5QYXltZW50TnVtYmVyXHJcbiAgICBsb2FuVG90YWxQYXltZW50c0NvdW50XHJcbiAgfVxyXG4gIC4uLiBvbiBQYXJ0aWFsUHJlUGF5bWVudCB7XHJcbiAgICBsb2FuRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbn1cclxuZnJhZ21lbnQgTWFuZGF0ZURldGFpbHNEYXRhIG9uIE1hbmRhdGVEZXRhaWxzIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgLi4uIG9uIE1hbmRhdGVQYXltZW50IHtcclxuICAgIG1hbmRhdGVEZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gTWFuZGF0ZVJldHVyblBheW1lbnQge1xyXG4gICAgbWFuZGF0ZURlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG59XHJcbmZyYWdtZW50IFNhdmluZ3NEZXRhaWxzRGF0YSBvbiBTYXZpbmdzRGV0YWlscyB7XHJcbiAgX190eXBlbmFtZVxyXG4gIC4uLiBvbiBGdWxsU2F2aW5nc1dpdGhkcmF3YWwge1xyXG4gICAgc2F2aW5nc0Rlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG4gIC4uLiBvbiBNb250aGx5U2F2aW5nc0RlcG9zaXQge1xyXG4gICAgc2F2aW5nc0RlcG9zaXROdW1iZXJcclxuICAgIHNhdmluZ3NEZXNjcmlwdGlvbktleVxyXG4gICAgc2F2aW5nc1RvdGFsRGVwb3NpdENvdW50XHJcbiAgfVxyXG4gIC4uLiBvbiBQYXJ0aWFsU2F2aW5nc1dpdGhkcmF3YWwge1xyXG4gICAgc2F2aW5nc0Rlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG4gIC4uLiBvbiBTYXZpbmdzQ2xvc2luZyB7XHJcbiAgICBzYXZpbmdzRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbiAgLi4uIG9uIFNhdmluZ3NEZXBvc2l0IHtcclxuICAgIHNhdmluZ3NEZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gU2F2aW5nc0ludGVyZXN0IHtcclxuICAgIHNhdmluZ3NEZXNjcmlwdGlvbktleVxyXG4gIH1cclxuICAuLi4gb24gU2F2aW5nc1BlbmFsdHkge1xyXG4gICAgc2F2aW5nc0Rlc2NyaXB0aW9uS2V5XHJcbiAgfVxyXG4gIC4uLiBvbiBTYXZpbmdzVGF4IHtcclxuICAgIHNhdmluZ3NEZXNjcmlwdGlvbktleVxyXG4gIH1cclxufVxyXG5mcmFnbWVudCBTdWJzY3JpcHRpb25EZXRhaWxzRGF0YSBvbiBTdWJzY3JpcHRpb25EZXRhaWxzIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgLi4uIG9uIFN1YnNjcmlwdGlvblBheW1lbnQge1xyXG4gICAgc3Vic2NyaXB0aW9uRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbiAgLi4uIG9uIFN1YnNjcmlwdGlvblJldHVyblBheW1lbnQge1xyXG4gICAgc3Vic2NyaXB0aW9uRGVzY3JpcHRpb25LZXlcclxuICB9XHJcbn1cclxuZnJhZ21lbnQgVHJhbnNhY3Rpb25zRGV0YWlsc0RhdGEgb24gVHJhbnNhY3Rpb25EZXRhaWxzIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgLi4uIG9uIEJhbmtUcmFuc2ZlciB7XHJcbiAgICBiYW5rX3RyYW5zZmVyX2RldGFpbHMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLkJhbmtUcmFuc2ZlckRldGFpbHNEYXRhXHJcbiAgICB9XHJcbiAgICBib29rX2RhdGVcclxuICAgIGNhdGVnb3JpZXMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLkNhdGVnb3J5RGF0YVxyXG4gICAgfVxyXG4gICAgcmVjdXJyZW5jZXMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLlJlY3VycmVuY2VEYXRhXHJcbiAgICB9XHJcbiAgICB2YWx1ZV9kYXRlXHJcbiAgfVxyXG4gIC4uLiBvbiBDYXJkIHtcclxuICAgIGNhcmRfZGV0YWlscyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uQ2FyZERldGFpbHNEYXRhXHJcbiAgICB9XHJcbiAgICBjYXRlZ29yaWVzIHtcclxuICAgICAgX190eXBlbmFtZVxyXG4gICAgICAuLi5DYXRlZ29yeURhdGFcclxuICAgIH1cclxuICAgIHJlY3VycmVuY2VzIHtcclxuICAgICAgX190eXBlbmFtZVxyXG4gICAgICAuLi5SZWN1cnJlbmNlRGF0YVxyXG4gICAgfVxyXG4gICAgdmFsdWVfZGF0ZVxyXG4gIH1cclxuICAuLi4gb24gQ2FzaCB7XHJcbiAgICBjYXNoX2RldGFpbHMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLkNhc2hEZXRhaWxzRGF0YVxyXG4gICAgfVxyXG4gICAgY2F0ZWdvcmllcyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uQ2F0ZWdvcnlEYXRhXHJcbiAgICB9XHJcbiAgICByZWN1cnJlbmNlcyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uUmVjdXJyZW5jZURhdGFcclxuICAgIH1cclxuICAgIHZhbHVlX2RhdGVcclxuICB9XHJcbiAgLi4uIG9uIENoZXF1ZXMge1xyXG4gICAgY2F0ZWdvcmllcyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uQ2F0ZWdvcnlEYXRhXHJcbiAgICB9XHJcbiAgICBjaGVxdWVzRGV0YWlscyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uQ2hlcXVlc0RldGFpbHNEYXRhXHJcbiAgICB9XHJcbiAgICByZWN1cnJlbmNlcyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uUmVjdXJyZW5jZURhdGFcclxuICAgIH1cclxuICAgIHZhbHVlRGF0ZVxyXG4gICAgcmVmZXJlbmNlTnVtYmVyXHJcbiAgICBmcm9udEltYWdlVXJsXHJcbiAgICBiYWNrSW1hZ2VVcmxcclxuICB9XHJcbiAgLi4uIG9uIERlZmF1bHQge1xyXG4gICAgZGVmYXVsdF9kZXRhaWxzIHtcclxuICAgICAgX190eXBlbmFtZVxyXG4gICAgICAuLi5EZWZhdWx0RGV0YWlsc0RhdGFcclxuICAgIH1cclxuICAgIHJlY3VycmVuY2VzIHtcclxuICAgICAgX190eXBlbmFtZVxyXG4gICAgICAuLi5SZWN1cnJlbmNlRGF0YVxyXG4gICAgfVxyXG4gICAgdmFsdWVfZGF0ZVxyXG4gIH1cclxuICAuLi4gb24gRmVlIHtcclxuICAgIGNhdGVnb3JpZXMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLkNhdGVnb3J5RGF0YVxyXG4gICAgfVxyXG4gICAgZmVlX2RldGFpbHMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLkZlZURldGFpbHNEYXRhXHJcbiAgICB9XHJcbiAgICB2YWx1ZV9kYXRlXHJcbiAgfVxyXG4gIC4uLiBvbiBMb2FucyB7XHJcbiAgICBjYXRlZ29yaWVzIHtcclxuICAgICAgX190eXBlbmFtZVxyXG4gICAgICAuLi5DYXRlZ29yeURhdGFcclxuICAgIH1cclxuICAgIGxvYW5fZGV0YWlscyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uTG9hbkRldGFpbHNEYXRhXHJcbiAgICB9XHJcbiAgICByZWN1cnJlbmNlcyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uUmVjdXJyZW5jZURhdGFcclxuICAgIH1cclxuICAgIHZhbHVlX2RhdGVcclxuICB9XHJcbiAgLi4uIG9uIE1hbmRhdGUge1xyXG4gICAgY2F0ZWdvcmllcyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uQ2F0ZWdvcnlEYXRhXHJcbiAgICB9XHJcbiAgICBtYW5kYXRlX2RldGFpbHMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLk1hbmRhdGVEZXRhaWxzRGF0YVxyXG4gICAgfVxyXG4gICAgcmVjdXJyZW5jZXMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLlJlY3VycmVuY2VEYXRhXHJcbiAgICB9XHJcbiAgICB2YWx1ZV9kYXRlXHJcbiAgfVxyXG4gIC4uLiBvbiBTYXZpbmdzIHtcclxuICAgIGNhdGVnb3JpZXMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLkNhdGVnb3J5RGF0YVxyXG4gICAgfVxyXG4gICAgcmVjdXJyZW5jZXMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLlJlY3VycmVuY2VEYXRhXHJcbiAgICB9XHJcbiAgICBzYXZpbmdzX2RldGFpbHMge1xyXG4gICAgICBfX3R5cGVuYW1lXHJcbiAgICAgIC4uLlNhdmluZ3NEZXRhaWxzRGF0YVxyXG4gICAgfVxyXG4gICAgdmFsdWVfZGF0ZVxyXG4gIH1cclxuICAuLi4gb24gU3Vic2NyaXB0aW9uVHJhbnNhY3Rpb24ge1xyXG4gICAgY2F0ZWdvcmllcyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uQ2F0ZWdvcnlEYXRhXHJcbiAgICB9XHJcbiAgICByZWN1cnJlbmNlcyB7XHJcbiAgICAgIF9fdHlwZW5hbWVcclxuICAgICAgLi4uUmVjdXJyZW5jZURhdGFcclxuICAgIH1cclxuICAgIHN1YnNjcmlwdGlvbl9kZXRhaWxzIHtcclxuICAgICAgX190eXBlbmFtZVxyXG4gICAgICAuLi5TdWJzY3JpcHRpb25EZXRhaWxzRGF0YVxyXG4gICAgfVxyXG4gICAgdmFsdWVfZGF0ZVxyXG4gIH1cclxufVxyXG5mcmFnbWVudCBUcmFuc2FjdGlvbkZyYWdtZW50IG9uIFRyYW5zYWN0aW9uIHtcclxuICBfX3R5cGVuYW1lXHJcbiAgYmFzZVRyYW5zYWN0aW9uIHtcclxuICAgIF9fdHlwZW5hbWVcclxuICAgIC4uLkJhc2VUcmFuc2FjdGlvbkZyYWdtZW50XHJcbiAgfVxyXG4gIGVucmljaG1lbnQge1xyXG4gICAgX190eXBlbmFtZVxyXG4gICAgLi4uVHJhbnNhY3Rpb25FbnJpY2htZW50RnJhZ21lbnRcclxuICB9XHJcbiAgbWV0YWRhdGEge1xyXG4gICAgX190eXBlbmFtZVxyXG4gICAgLi4uVHJhbnNhY3Rpb25FdmVudE1ldGFkYXRhRnJhZ21lbnRcclxuICB9XHJcbiAgcmVmZXJlbmNlTnVtYmVyXHJcbiAgdHJhbnNhY3Rpb25EZXRhaWxzIHtcclxuICAgIF9fdHlwZW5hbWVcclxuICAgIC4uLlRyYW5zYWN0aW9uc0RldGFpbHNEYXRhXHJcbiAgfVxyXG59XHJcbmZyYWdtZW50IE1vdmVtZW50RnJhZ21lbnQgb24gTW92ZW1lbnQge1xyXG4gIF9fdHlwZW5hbWVcclxuICBhY2NvdW50SWRcclxuICBiYW5rQ3VycmVuY3lBbW91bnRcclxuICBib29raW5nRGF0ZVxyXG4gIGNvbnZlcnNpb25SYXRlXHJcbiAgY3JlZGl0RGViaXRcclxuICBkZXNjcmlwdGlvblxyXG4gIGlzUmV2ZXJzZWRcclxuICBsaW5rVHJhbnNhY3Rpb24ge1xyXG4gICAgX190eXBlbmFtZVxyXG4gICAgLi4uVHJhbnNhY3Rpb25GcmFnbWVudFxyXG4gIH1cclxuICBtb3ZlbWVudEFtb3VudFxyXG4gIG1vdmVtZW50Q3VycmVuY3lcclxuICBtb3ZlbWVudElkXHJcbiAgbW92ZW1lbnRSZXZlcnNlZElkXHJcbiAgbW92ZW1lbnRUaW1lc3RhbXBcclxuICBtb3ZlbWVudFR5cGVcclxuICBwb3J0Zm9saW9JZFxyXG4gIHJ1bm5pbmdCYWxhbmNlXHJcbiAgdHJhbnNhY3Rpb24ge1xyXG4gICAgX190eXBlbmFtZVxyXG4gICAgLi4uVHJhbnNhY3Rpb25GcmFnbWVudFxyXG4gIH1cclxuICB2YWx1ZURhdGVcclxufVxyXG5mcmFnbWVudCBQYWdpbmF0aW9uRnJhZ21lbnQgb24gUGFnaW5hdGlvbiB7XHJcbiAgX190eXBlbmFtZVxyXG4gIGN1cnNvclxyXG4gIGhhc01vcmVcclxufVxyXG5mcmFnbWVudCBNb3ZlbWVudHNGcmFnbWVudCBvbiBNb3ZlbWVudHMge1xyXG4gIF9fdHlwZW5hbWVcclxuICBpc1J1bm5pbmdCYWxhbmNlSW5TeW5jXHJcbiAgbW92ZW1lbnRzIHtcclxuICAgIF9fdHlwZW5hbWVcclxuICAgIC4uLk1vdmVtZW50RnJhZ21lbnRcclxuICB9XHJcbiAgcGFnaW5hdGlvbiB7XHJcbiAgICBfX3R5cGVuYW1lXHJcbiAgICAuLi5QYWdpbmF0aW9uRnJhZ21lbnRcclxuICB9XHJcbn1gO1xyXG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFPLE1BQU1BLFlBQVksR0FBQUMsT0FBQSxDQUFBRCxZQUFBLEdBQUc7QUFDNUI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxDQUFDO0FBRU0sTUFBTUUsYUFBYSxHQUFBRCxPQUFBLENBQUFDLGFBQUEsR0FBRztBQUM3QjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsRUFBRSIsImlnbm9yZUxpc3QiOltdfQ==