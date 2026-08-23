/**
 * Pagi (FIBI group) scrape shape — the `IApiDirectScrapeShape` data
 * declaration consumed by the generic buildGenericHeadlessScrape driver via
 * `withBrowserApiDirect`. balanceKind=account.
 *
 * Account identity spans two cookie-authed GETs: `userData` (customer) for the
 * account number + branch, and a session-level `accountType` lookup
 * (customer.secondaryUrlTag) for the numeric type that the balance path segment
 * and the transactions body both need. Balance is a GET; transactions a single
 * full-window POST. The family wiring — envelope, identity merge, extractors —
 * comes from the neutral FibiGroup factory; this module supplies what is the
 * brand’s own: its origin-bound URLs, its step name, and its
 * coverage-backfill stance.
 *
 * The stance stays declared here, not inherited, so the WINDOW-CANARY gate
 * keeps seeing a conscious per-bank decision.
 *
 * Contract shared with Beinleumi (same FIBI Mataf portal), assembled by the
 * neutral FibiGroup factory. Grounded in the captured trace
 * (C:\tmp\runs\pipeline\beinleumi\04-07-2026_11221970). Replaces the
 * generic AUTH-DISCOVERY/ACCOUNT-RESOLVE/DASHBOARD chain.
 */

import { makeFibiGroupShape } from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShape.js';
import { customerUrl, secondaryUrl } from './PagiShapeAccounts.js';
import { balanceUrl } from './PagiShapeHelpers.js';
import { txnsUrl } from './PagiShapeTxns.js';

/** Pagi hard-model shape — passed to `.withBrowserApiDirect(...)`. */
const PAGI_SHAPE = makeFibiGroupShape({
  stepName: 'PagiScrape',
  windowNarrowing: 'windowEnd',
  customerUrl,
  secondaryUrl,
  balanceUrl,
  txnsUrl,
});

export default PAGI_SHAPE;
export { PAGI_SHAPE };
