/**
 * OneZero GraphQL query strings — data only.
 * Ported verbatim from legacy src/Scrapers/OneZero/OneZeroQueries.ts.
 * Side-effect: registers each query into WK at module load.
 * Fragments are split across sibling files to honour per-file LOC limit.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { registerWkQuery } from '../../../Registry/WK/QueriesWK.js';
import {
  BANK_TRANSFER_DETAILS,
  CARD_DETAILS,
  CASH_DETAILS,
  CATEGORY_AND_RECURRENCE as DETAIL_CATEGORY_AND_RECURRENCE,
  CHEQUES_DETAILS,
  DEFAULT_DETAILS,
  FEE_DETAILS,
  MOVEMENTS_FRAGMENTS_2,
} from './OneZeroFragments.js';
import {
  BASE_TRANSACTION,
  CATEGORY_AND_RECURRENCE as BASE_CATEGORY_AND_RECURRENCE,
  COUNTER_PARTY_REFERENCE,
  COUNTER_PARTY_TRANSFER,
  INSTRUMENT_AMOUNT,
  TRANSACTION_ENRICHMENT,
  TRANSACTION_METADATA,
} from './OneZeroMovementsBase.js';
import {
  GET_ACCOUNT_BALANCE_QUERY,
  GET_CUSTOMER_QUERY,
  GET_MOVEMENTS_ROOT,
} from './OneZeroQueryRoots.js';

const HINT = CompanyTypes.OneZero;

/** Root + fragment chain assembled verbatim from the legacy OneZeroQueries.ts. */
const GET_MOVEMENTS = [
  GET_MOVEMENTS_ROOT,
  INSTRUMENT_AMOUNT,
  COUNTER_PARTY_REFERENCE,
  BASE_TRANSACTION,
  BASE_CATEGORY_AND_RECURRENCE,
  TRANSACTION_ENRICHMENT,
  TRANSACTION_METADATA,
  COUNTER_PARTY_TRANSFER,
  BANK_TRANSFER_DETAILS,
  DETAIL_CATEGORY_AND_RECURRENCE,
  CARD_DETAILS,
  CASH_DETAILS,
  CHEQUES_DETAILS,
  DEFAULT_DETAILS,
  FEE_DETAILS,
  MOVEMENTS_FRAGMENTS_2,
].join('\n');

const GET_CUSTOMER = GET_CUSTOMER_QUERY;
const GET_ACCOUNT_BALANCE = GET_ACCOUNT_BALANCE_QUERY;

registerWkQuery('customer', HINT, GET_CUSTOMER);
registerWkQuery('transactions', HINT, GET_MOVEMENTS);
registerWkQuery('balance', HINT, GET_ACCOUNT_BALANCE);

export { GET_ACCOUNT_BALANCE, GET_CUSTOMER, GET_MOVEMENTS };
