/**
 * Otsar Hahayal (FIBI group) scrape shape — the brand's binding of the shared FIBI
 * family contract: its post-login API origin, plus the origin-bound balance
 * URL. The origin-independent primitives (paths, account shape, balance
 * extractor, no-op vars) come from the neutral FibiGroup factory.
 *
 * Otsar Hahayal is a First-International (FIBI) group brand. The BFF path
 * shape (userData + bff-balancetransactions) is shared with its siblings
 * through FibiGroup — never imported from another bank — but the host is
 * Otsar Hahayal's own online origin (online.bankotsar.co.il), NOT
 * Beinleumi's online.fibi.co.il. The api-direct login runs on that same
 * origin, so the scrape rides its cookie session. balanceKind=account. The
 * shared BFF paths on this host are covered by mocked tests only; no live
 * Otsar Hahayal run has been recorded yet.
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
