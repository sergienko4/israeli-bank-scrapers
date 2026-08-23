/**
 * Pagi (FIBI group) scrape shape — the brand's binding of the shared FIBI
 * family contract: its post-login API origin, plus the origin-bound balance
 * URL. The origin-independent primitives (paths, account shape, balance
 * extractor, no-op vars) come from the neutral FibiGroup factory.
 *
 * Pagi is a First-International (FIBI) group brand. The Mataf/appsng BFF
 * contract (userData + bff-balancetransactions) is shared with its siblings
 * through the neutral FibiGroup factory — never imported from another bank —
 * and only the API host differs. The host follows the proven FIBI
 * `online.<login-domain>` transform: login www.pagi.co.il -> API
 * online.pagi.co.il (DNS-confirmed on the shared FIBI subnet; same
 * registrable domain, so the session cookies set at login ride to the API
 * host — the mechanism proven live for Beinleumi www.fibi.co.il ->
 * online.fibi.co.il). An earlier clone wrongly used a bankpoalim.co.il host
 * — Pagi is FIBI-group, not Hapoalim. balanceKind=account. Host DNS +
 * pattern-grounded; a full live-E2E on real credentials is still pending.
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

/** Pagi BFF origin — post-login API host (same registrable domain as login). */
export const PAGI_API = 'https://online.pagi.co.il';

/** Pagi's binding of the shared FIBI contract. */
export const PAGI_CONFIG: IFibiGroupConfig = { apiOrigin: PAGI_API };

/** Pagi account reference — the shared FIBI account shape. */
export type IPagiAcct = IFibiAcct;

/**
 * Balance URL — balances/<accountType> on the Pagi origin.
 * @param acct - Pagi account.
 * @returns Literal balances URL for the account.
 */
export function balanceUrl(acct: IPagiAcct): WKUrlOrLiteral {
  return fibiBalanceUrl(PAGI_CONFIG, acct);
}
