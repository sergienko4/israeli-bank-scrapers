/**
 * Massad (FIBI group) scrape shape — the brand's binding of the shared FIBI
 * family contract: its post-login API origin, plus the origin-bound balance
 * URL. The origin-independent primitives (paths, account shape, balance
 * extractor, no-op vars) come from the neutral FibiGroup factory.
 *
 * Massad is a First-International (FIBI) group brand. The BFF path shape
 * (userData + bff-balancetransactions) is shared with its siblings through
 * FibiGroup — never imported from another bank — but the host is Massad's
 * own online origin (online.bankmassad.co.il), NOT Beinleumi's
 * online.fibi.co.il. The api-direct login runs on that same origin, so the
 * scrape rides its cookie session. balanceKind=account. The shared BFF
 * paths on this host are covered by mocked tests only; no live Massad run
 * has been recorded yet.
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

/** Massad BFF origin — post-login API host (same-origin as login). */
export const MASSAD_API = 'https://online.bankmassad.co.il';

/** Massad's binding of the shared FIBI contract. */
export const MASSAD_CONFIG: IFibiGroupConfig = { apiOrigin: MASSAD_API };

/** Massad account reference — the shared FIBI account shape. */
export type IMassadAcct = IFibiAcct;

/**
 * Balance URL — balances/<accountType> on the Massad origin.
 * @param acct - Massad account.
 * @returns Literal balances URL for the account.
 */
export function balanceUrl(acct: IMassadAcct): WKUrlOrLiteral {
  return fibiBalanceUrl(MASSAD_CONFIG, acct);
}
