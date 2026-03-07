import { MOVEMENTS_FRAGMENTS_2 } from './OneZeroFragments';

export const GET_ACCOUNT_BALANCE = `
query GetAccountBalance($portfolioId: String!, $accountId: String!) {
  balance(portfolioId: $portfolioId, accountId: $accountId) {
    currentAccountBalance
    currentAccountBalanceStr
    blockedAmountStr
    limitAmountStr
  }
}
`;

export const GET_CUSTOMER = `
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
      ...IPortfolio
    }
    status
  }
}
fragment IPortfolio on IPortfolio {
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

export const GET_MOVEMENTS = `query GetMovements(
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
fragment CategoryFragment on ICategory {
  __typename
  categoryId
  dataSource
  subCategoryId
}
fragment RecurrenceFragment on IRecurrence {
  __typename
  dataSource
  isRecurrent
}
fragment TransactionEnrichmentFragment on ITransactionEnrichment {
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
fragment CategoryData on ICategory {
  __typename
  categoryId
  dataSource
  subCategoryId
}
fragment RecurrenceData on IRecurrence {
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
${MOVEMENTS_FRAGMENTS_2}`;
