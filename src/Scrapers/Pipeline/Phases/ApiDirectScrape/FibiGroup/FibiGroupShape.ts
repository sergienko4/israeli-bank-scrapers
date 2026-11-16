/**
 * FIBI group scrape shape — the neutral family factory that assembles one
 * brand's `IApiDirectScrapeShape` from the brand's own URL providers.
 *
 * Account identity spans two cookie-authed GETs: `userData` (customer) for
 * the account number + branch, and a session-level `accountType` lookup
 * (customer.secondaryUrlTag) for the numeric type that the balance path
 * segment and the transactions body both need. Balance is a GET;
 * transactions a single full-window POST. balanceKind=account.
 *
 * The factory owns what every FIBI brand shares — the request envelope, the
 * per-call headers, the identity merge, the response extractors, and the
 * origin-bound URL builders. The brand supplies its own `IFibiBrand` record,
 * its step name, and its coverage-backfill stance, so each brand keeps
 * declaring its own stance in its own module (which the WINDOW-CANARY gate
 * scans) and no bank ever imports another bank.
 */

import type { IFibiBrand } from '../../../Registry/Config/PipelineBankConfigFibiFamilyConstants.js';
import type { IApiDirectScrapeShape, WindowNarrowing } from '../IApiDirectScrapeShape.js';
import {
  accountNumberOf,
  customerUrl as fibiCustomerUrl,
  extractAccounts,
  secondaryUrl as fibiSecondaryUrl,
} from './FibiGroupShapeAccounts.js';
import fibiCallHeaders from './FibiGroupShapeHeaders.js';
import {
  balanceExtract,
  balanceUrl as fibiBalanceUrl,
  type IFibiAcct,
  noVars,
} from './FibiGroupShapeHelpers.js';
import { txnsExtractPage, txnsUrl as fibiTxnsUrl, txnsVars } from './FibiGroupShapeTxns.js';

/** One FIBI brand's binding of the shared family contract. */
interface IFibiGroupShapeArgs {
  /** The brand's own origin + portal identity from the bank registry. */
  readonly brand: IFibiBrand;
  /** Pipeline step name, e.g. `MassadScrape`. */
  readonly stepName: string;
  /** The brand's own coverage-backfill stance. */
  readonly windowNarrowing: WindowNarrowing;
}

type FibiShape = IApiDirectScrapeShape<IFibiAcct, never>;

/** The brand's origin in the family URL-builder shape. */
interface IFibiOrigin {
  readonly apiOrigin: string;
}

/**
 * Account-identity step — userData for number + branch, plus the
 * session-level accountType lookup folded in as `secondaryBody`.
 * @param origin - Brand origin binding.
 * @returns Customer step bound to the brand's origin.
 */
function customerOf(origin: IFibiOrigin): FibiShape['customer'] {
  return {
    buildVars: noVars,
    extractAccounts,
    /**
     * userData URL with a fresh uid.
     * @returns Brand-bound userData URL.
     */
    urlTag: () => fibiCustomerUrl(origin),
    /**
     * Session accountType URL with a fresh uid.
     * @returns Brand-bound accountType URL.
     */
    secondaryUrlTag: () => fibiSecondaryUrl(origin),
    method: 'GET',
    extraHeaders: fibiCallHeaders,
  };
}

/**
 * Balance step — GET balances/<accountType> on the brand's origin.
 * @param origin - Brand origin binding.
 * @returns Balance step bound to the brand's origin.
 */
function balanceOf(origin: IFibiOrigin): FibiShape['balance'] {
  return {
    buildVars: noVars,
    extract: balanceExtract,
    /**
     * Balance URL for one account.
     * @param acct - FIBI account.
     * @returns Brand-bound balances URL.
     */
    urlTag: (acct): ReturnType<typeof fibiBalanceUrl> => fibiBalanceUrl(origin, acct),
    method: 'GET',
    extraHeaders: fibiCallHeaders,
  };
}

/**
 * Transactions step — one full-window POST; the brand supplies its own
 * coverage-backfill stance.
 * @param args - Brand record and window stance.
 * @param origin - Brand origin binding.
 * @returns Transactions step bound to the brand's origin.
 */
function transactionsOf(args: IFibiGroupShapeArgs, origin: IFibiOrigin): FibiShape['transactions'] {
  return {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    windowNarrowing: args.windowNarrowing,
    /**
     * Fixed transactions-list URL.
     * @returns Brand-bound transactions-list URL.
     */
    urlTag: () => fibiTxnsUrl(origin),
    method: 'POST',
    extraHeaders: fibiCallHeaders,
  };
}

/**
 * Assemble one FIBI brand's hard-model scrape shape.
 * @param args - Brand record, step name and backfill stance.
 * @returns Shape passed to `.withApiDirect(...)`.
 */
function makeFibiGroupShape(args: IFibiGroupShapeArgs): FibiShape {
  const origin: IFibiOrigin = { apiOrigin: args.brand.origin };
  return {
    stepName: args.stepName,
    accountNumberOf,
    customer: customerOf(origin),
    balance: balanceOf(origin),
    transactions: transactionsOf(args, origin),
  };
}

export default makeFibiGroupShape;
