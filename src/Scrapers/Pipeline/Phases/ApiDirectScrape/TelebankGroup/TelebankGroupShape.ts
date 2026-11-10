/**
 * Telebank group scrape shape — the neutral family factory that assembles
 * one brand's `IApiDirectScrapeShape` over the shared Titan API.
 *
 * Auth is the session cookies the API-DIRECT-CALL login set, kept by the
 * node transport, plus the routing headers every Titan call echoes from
 * them ({@link titanHeaders}); balance and transactions name their account
 * in `accountnumber`. Every answer passes {@link checkTitanBody} first. All
 * three Titan calls are GET. balanceKind=account.
 *
 * Every brand reads the same Titan host, so the factory owns the URLs, the
 * headers, the check and the extractors. The step name and the
 * coverage-backfill stance stay with the brand, so each brand keeps
 * declaring its own stance in its own module (which the WINDOW-CANARY gate
 * scans) and no bank ever imports another bank.
 */

import type { IApiDirectScrapeShape, WindowNarrowing } from '../IApiDirectScrapeShape.js';
import { checkTitanBody } from './TelebankGroupShapeCheck.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceUrl,
  callAccountIdOf,
  customerUrl,
  extractAccounts,
  type ITelebankAcct,
  noVars,
  titanHeaders,
} from './TelebankGroupShapeHelpers.js';
import { txnsExtractPage, txnsUrl, txnsVars } from './TelebankGroupShapeTxns.js';

/** One Telebank brand's binding of the shared family contract. */
export interface ITelebankGroupShapeArgs {
  /** Pipeline step name, e.g. `DiscountScrape`. */
  readonly stepName: string;
  /** The brand's own coverage-backfill stance. */
  readonly windowNarrowing: WindowNarrowing;
}

type TelebankShape = IApiDirectScrapeShape<ITelebankAcct, never>;

/** Accounts step — the customer's account list. */
const CUSTOMER_STEP: TelebankShape['customer'] = {
  buildVars: noVars,
  extractAccounts,
  urlTag: customerUrl,
  method: 'GET',
  extraHeaders: titanHeaders,
};

/** Balance step — one account's current balance. */
const BALANCE_STEP: TelebankShape['balance'] = {
  buildVars: noVars,
  extract: balanceExtract,
  urlTag: balanceUrl,
  method: 'GET',
  extraHeaders: titanHeaders,
};

/**
 * Transactions step — one date-range page; the brand supplies its own
 * coverage-backfill stance.
 * @param args - Brand binding supplying the window stance.
 * @returns Transactions step for the brand.
 */
function transactionsOf(args: ITelebankGroupShapeArgs): TelebankShape['transactions'] {
  return {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    windowNarrowing: args.windowNarrowing,
    urlTag: txnsUrl,
    method: 'GET',
    extraHeaders: titanHeaders,
  };
}

/**
 * The brand's three steps — customer, balance and transactions.
 * @param args - Brand binding supplying the window stance.
 * @returns The step triple the shape is assembled from.
 */
function brandSteps(
  args: ITelebankGroupShapeArgs,
): Pick<TelebankShape, 'customer' | 'balance' | 'transactions'> {
  const transactions = transactionsOf(args);
  return { customer: CUSTOMER_STEP, balance: BALANCE_STEP, transactions };
}

/**
 * Assemble one Telebank brand's hard-model scrape shape.
 * @param args - Brand binding: step name and backfill stance.
 * @returns Shape passed to `.withApiDirect(...)`.
 */
export function makeTelebankGroupShape(args: ITelebankGroupShapeArgs): TelebankShape {
  return {
    stepName: args.stepName,
    accountNumberOf,
    callAccountIdOf,
    checkBody: checkTitanBody,
    ...brandSteps(args),
  };
}
