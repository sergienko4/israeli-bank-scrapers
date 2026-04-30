/**
 * OneZero GraphQL fragments — data only.
 * Aggregator module: combines fragment groups split across sibling
 * files to keep every file ≤ 150 LOC. Ported verbatim from legacy
 * src/Scrapers/OneZero/OneZeroFragments.ts.
 */

import {
  BANK_TRANSFER_DETAILS,
  CARD_DETAILS,
  CASH_DETAILS,
  CATEGORY_AND_RECURRENCE,
  CHEQUES_DETAILS,
  DEFAULT_DETAILS,
  FEE_DETAILS,
} from './OneZeroFragmentsDetails.js';
import {
  LOAN_DETAILS,
  MANDATE_DETAILS,
  MOVEMENT_AND_PAGINATION,
  SAVINGS_DETAILS,
  SUBSCRIPTION_DETAILS,
} from './OneZeroFragmentsMovements.js';
import { TRANSACTION_DETAILS, TRANSACTION_WRAPPER } from './OneZeroFragmentsTransactions.js';

/** Combined movement-tail GraphQL fragments — appended to GET_MOVEMENTS. */
const MOVEMENTS_FRAGMENTS_2 = [
  LOAN_DETAILS,
  MANDATE_DETAILS,
  SAVINGS_DETAILS,
  SUBSCRIPTION_DETAILS,
  TRANSACTION_DETAILS,
  TRANSACTION_WRAPPER,
  MOVEMENT_AND_PAGINATION,
].join('\n');

export {
  BANK_TRANSFER_DETAILS,
  CARD_DETAILS,
  CASH_DETAILS,
  CATEGORY_AND_RECURRENCE,
  CHEQUES_DETAILS,
  DEFAULT_DETAILS,
  FEE_DETAILS,
  MOVEMENTS_FRAGMENTS_2,
};
export default MOVEMENTS_FRAGMENTS_2;
