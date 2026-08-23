/**
 * Beinleumi (FIBI group) scrape shape — the brand's binding of the shared FIBI
 * family contract: its post-login API origin, plus the origin-bound balance
 * URL. The origin-independent primitives (paths, account shape, balance
 * extractor, no-op vars) come from the neutral FibiGroup factory.
 *
 * Beinleumi is the progenitor of the First-International (FIBI) group shape:
 * the Mataf/appsng BFF contract captured here is the one its sibling brands
 * share through the neutral FibiGroup factory. Every post-login call is
 * cookie-authed (session cookies ride the live login page through
 * BrowserFetchStrategy) and every GET carries a fresh random uid.
 * balanceKind=account: balance reads `currentBalance` from
 * `balances/<accountType>`. This is the only FIBI brand proven by a live
 * E2E run; the siblings clone its paths onto their own hosts.
 */

import {
  balanceUrl as fibiBalanceUrl,
  type IFibiAcct,
  type IFibiGroupConfig,
} from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeHelpers.js';
import type { WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';

export {
  balanceExtract,
  BFF_BASE,
  noVars,
  USER_DATA_PATH,
} from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeHelpers.js';

/** Beinleumi BFF origin — post-login API host (same registrable domain as login). */
export const BEINLEUMI_API = 'https://online.fibi.co.il';

/** Beinleumi's binding of the shared FIBI contract. */
export const BEINLEUMI_CONFIG: IFibiGroupConfig = { apiOrigin: BEINLEUMI_API };

/** Beinleumi account reference — the shared FIBI account shape. */
export type IBeinleumiAcct = IFibiAcct;

/**
 * Balance URL — balances/<accountType> on the Beinleumi origin.
 * @param acct - Beinleumi account.
 * @returns Literal balances URL for the account.
 */
export function balanceUrl(acct: IBeinleumiAcct): WKUrlOrLiteral {
  return fibiBalanceUrl(BEINLEUMI_CONFIG, acct);
}
