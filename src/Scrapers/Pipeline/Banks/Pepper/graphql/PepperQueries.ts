/**
 * Pepper GraphQL query strings — data only.
 * Three operations: customer (UserDataV2), balance (fetchAccountBalance),
 * transactions (Transactions). Registered into WK at module load.
 * The Pepper GraphQL gateway also requires a `queryname` request header
 * matching the operation name — consumed by the scrape shape as extraHeaders.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { registerWkQuery } from '../../../Registry/WK/QueriesWK.js';

const HINT = CompanyTypes.Pepper;

const USER_DATA_V2 = `
query UserDataV2 {
  userDataV2 {
    getUserDataV2 {
      customerAndAccounts {
        customerId
        accounts {
          accountId
          accountNumber
          accountCategory
        }
      }
    }
  }
}
`;

const FETCH_ACCOUNT_BALANCE = `
query fetchAccountBalance($accountId: String!) {
  accounts {
    balance(accountId: $accountId) {
      currentBalance
    }
  }
}
`;

const TRANSACTIONS = `
query Transactions(
  $accountId: String!
  $from: String
  $to: String
  $pageNumber: Int
  $pageCount: Int
) {
  accounts {
    oshTransactionsNew(
      accountId: $accountId
      from: $from
      to: $to
      pageNumber: $pageNumber
      pageCount: $pageCount
    ) {
      totalCount
      transactions {
        transactionId
        transactionAmount
        bookingDate
        effectiveDate
        currency
        description
        title
        subTitle
        referenceNumber
        liquidityStatus
      }
      pendingTransactions {
        transactionId
        transactionAmount
        bookingDate
        effectiveDate
        currency
        description
        title
        subTitle
        referenceNumber
        liquidityStatus
      }
    }
  }
}
`;

registerWkQuery('customer', HINT, USER_DATA_V2);
registerWkQuery('balance', HINT, FETCH_ACCOUNT_BALANCE);
registerWkQuery('transactions', HINT, TRANSACTIONS);

export { FETCH_ACCOUNT_BALANCE, TRANSACTIONS, USER_DATA_V2 };
