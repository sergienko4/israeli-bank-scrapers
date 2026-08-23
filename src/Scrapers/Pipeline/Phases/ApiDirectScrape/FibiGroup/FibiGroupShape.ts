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
 * The factory owns only what every FIBI brand shares — the request
 * envelope, the identity merge, and the response extractors. Origin,
 * step name, and coverage-backfill stance stay with the brand, so each
 * brand keeps declaring its own stance in its own module (which the
 * WINDOW-CANARY gate scans) and no bank ever imports another bank.
 */

import type { WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IApiDirectScrapeShape, WindowNarrowing } from '../IApiDirectScrapeShape.js';
import { accountNumberOf, extractAccounts } from './FibiGroupShapeAccounts.js';
import { balanceExtract, type IFibiAcct, noVars } from './FibiGroupShapeHelpers.js';
import { txnsExtractPage, txnsVars } from './FibiGroupShapeTxns.js';

/** One FIBI brand's binding of the shared family contract. */
export interface IFibiGroupShapeArgs {
  /** Pipeline step name, e.g. `MassadScrape`. */
  readonly stepName: string;
  /** The brand's own coverage-backfill stance. */
  readonly windowNarrowing: WindowNarrowing;
  /** userData accounts endpoint on the brand's origin. */
  readonly customerUrl: () => WKUrlOrLiteral;
  /** Session-level accountType lookup on the brand's origin. */
  readonly secondaryUrl: () => WKUrlOrLiteral;
  /** Per-account balances endpoint on the brand's origin. */
  readonly balanceUrl: (acct: IFibiAcct) => WKUrlOrLiteral;
  /** Fixed transactions-list endpoint on the brand's origin. */
  readonly txnsUrl: () => WKUrlOrLiteral;
}

type FibiShape = IApiDirectScrapeShape<IFibiAcct, never>;

/**
 * Account-identity step — userData for number + branch, plus the
 * session-level accountType lookup folded in as `secondaryBody`.
 * @param args - Brand binding supplying the identity URLs.
 * @returns Customer step bound to the brand's origin.
 */
function customerOf(args: IFibiGroupShapeArgs): FibiShape['customer'] {
  return {
    buildVars: noVars,
    extractAccounts,
    urlTag: args.customerUrl,
    secondaryUrlTag: args.secondaryUrl,
    method: 'GET',
  };
}

/**
 * Balance step — GET balances/<accountType> on the brand's origin.
 * @param args - Brand binding supplying the balance URL.
 * @returns Balance step bound to the brand's origin.
 */
function balanceOf(args: IFibiGroupShapeArgs): FibiShape['balance'] {
  return { buildVars: noVars, extract: balanceExtract, urlTag: args.balanceUrl, method: 'GET' };
}

/**
 * Transactions step — one full-window POST; the brand supplies its own
 * coverage-backfill stance.
 * @param args - Brand binding supplying the list URL and window stance.
 * @returns Transactions step bound to the brand's origin.
 */
function transactionsOf(args: IFibiGroupShapeArgs): FibiShape['transactions'] {
  return {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    windowNarrowing: args.windowNarrowing,
    urlTag: args.txnsUrl,
    method: 'POST',
  };
}

/**
 * Assemble one FIBI brand's hard-model scrape shape.
 * @param args - Brand binding: URL providers, step name, backfill stance.
 * @returns Shape passed to `.withBrowserApiDirect(...)`.
 */
export function makeFibiGroupShape(args: IFibiGroupShapeArgs): FibiShape {
  return {
    stepName: args.stepName,
    accountNumberOf,
    customer: customerOf(args),
    balance: balanceOf(args),
    transactions: transactionsOf(args),
  };
}
