/**
 * OneZero GraphQL fragment strings — movement groups (loan, mandate,
 * savings, subscription, movement+pagination).
 * Data only.
 */

/** Loan-detail union. */
const LOAN_DETAILS = `
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
}`;

/** Mandate-detail union. */
const MANDATE_DETAILS = `
fragment MandateDetailsData on MandateDetails {
  __typename
  ... on MandatePayment {
    mandateDescriptionKey
  }
  ... on MandateReturnPayment {
    mandateDescriptionKey
  }
}`;

/** Savings-detail union. */
const SAVINGS_DETAILS = `
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
}`;

/** Subscription-detail union. */
const SUBSCRIPTION_DETAILS = `
fragment SubscriptionDetailsData on SubscriptionDetails {
  __typename
  ... on SubscriptionPayment {
    subscriptionDescriptionKey
  }
  ... on SubscriptionReturnPayment {
    subscriptionDescriptionKey
  }
}`;

/** Movement + pagination + container fragments. */
const MOVEMENT_AND_PAGINATION = `
fragment MovementFragment on Movement {
  __typename
  accountId
  bankCurrencyAmount
  bookingDate
  conversionRate
  creditDebit
  description
  isReversed
  linkTransaction { __typename ...TransactionFragment }
  movementAmount
  movementCurrency
  movementId
  movementReversedId
  movementTimestamp
  movementType
  portfolioId
  runningBalance
  transaction { __typename ...TransactionFragment }
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
  movements { __typename ...MovementFragment }
  pagination { __typename ...PaginationFragment }
}`;

export {
  LOAN_DETAILS,
  MANDATE_DETAILS,
  MOVEMENT_AND_PAGINATION,
  SAVINGS_DETAILS,
  SUBSCRIPTION_DETAILS,
};
