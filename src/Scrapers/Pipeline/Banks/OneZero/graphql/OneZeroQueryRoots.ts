/**
 * OneZero GraphQL query root strings — data only.
 * The three operation roots (customer, movements, balance) plus the
 * opening line of GET_MOVEMENTS. Full fragment composition happens
 * in OneZeroQueries.ts.
 */

/** GetAccountBalance — single-statement query. */
const GET_ACCOUNT_BALANCE_QUERY = `
query GetAccountBalance($portfolioId: String!, $accountId: String!) {
  balance(portfolioId: $portfolioId, accountId: $accountId) {
    currentAccountBalance
    currentAccountBalanceStr
    blockedAmountStr
    limitAmountStr
  }
}
`;

/** GetCustomer — returns portfolios + accounts. */
const GET_CUSTOMER_QUERY = `
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
    status
  }
}
`;

/** GetMovements — root query; fragments are composed in OneZeroQueries.ts. */
const GET_MOVEMENTS_ROOT = `query GetMovements(
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
}`;

export { GET_ACCOUNT_BALANCE_QUERY, GET_CUSTOMER_QUERY, GET_MOVEMENTS_ROOT };
