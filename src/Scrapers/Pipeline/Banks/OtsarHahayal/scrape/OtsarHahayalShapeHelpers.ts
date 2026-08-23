/**
 * Otsar Hahayal (FIBI group) scrape shape — the brand's binding of the shared FIBI
 * family contract: its post-login API origin, plus the origin-bound balance
 * URL. The origin-independent primitives (paths, account shape, balance
 * extractor, no-op vars) come from the neutral FibiGroup factory.
 *
 * Otsar Hahayal is a First-International (FIBI) group brand. The Mataf/appsng
 * BFF contract (userData + bff-balancetransactions) is shared with its
 * siblings through the neutral FibiGroup factory — never imported from
 * another bank — and only the API host differs. The host follows the proven
 * FIBI `online.<login-domain>` transform: login www.bankotsar.co.il -> API
 * online.bankotsar.co.il (DNS-confirmed on the shared FIBI subnet; same
 * registrable domain, so the session cookies set at login ride to the API
 * host — the mechanism proven live for Beinleumi www.fibi.co.il ->
 * online.fibi.co.il). balanceKind=account. Host DNS + pattern-grounded; a
 * full live-E2E on real credentials is still pending.
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

/** Otsar Hahayal BFF origin — post-login API host (same registrable domain as login). */
export const OTSAR_HAHAYAL_API = 'https://online.bankotsar.co.il';

/** Otsar Hahayal's binding of the shared FIBI contract. */
export const OTSAR_HAHAYAL_CONFIG: IFibiGroupConfig = { apiOrigin: OTSAR_HAHAYAL_API };

/** Otsar Hahayal account reference — the shared FIBI account shape. */
export type IOtsarHahayalAcct = IFibiAcct;

/**
 * Balance URL — balances/<accountType> on the Otsar Hahayal origin.
 * @param acct - Otsar Hahayal account.
 * @returns Literal balances URL for the account.
 */
export function balanceUrl(acct: IOtsarHahayalAcct): WKUrlOrLiteral {
  return fibiBalanceUrl(OTSAR_HAHAYAL_CONFIG, acct);
}
