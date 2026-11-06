/**
 * Mercantile (Telebank group) scrape shape — the `IApiDirectScrapeShape` data
 * declaration consumed by the generic buildGenericHeadlessScrape driver via
 * `withApiDirect`. balanceKind=account.
 *
 * Mercantile reads the same Titan tenant as Discount, so the family wiring —
 * the Titan URLs, the routing headers, the answer check and the extractors —
 * comes from the neutral TelebankGroup factory; this module supplies what is
 * Mercantile's own: its step name and its coverage-backfill stance. The
 * stance stays declared here, not inherited, so the WINDOW-CANARY gate keeps
 * seeing a conscious per-bank decision.
 */

import { makeTelebankGroupShape } from '../../../Phases/ApiDirectScrape/TelebankGroup/TelebankGroupShape.js';

/** Mercantile hard-model shape — passed to `.withApiDirect(...)`. */
const MERCANTILE_SHAPE = makeTelebankGroupShape({
  stepName: 'MercantileScrape',
  windowNarrowing: 'lowerBoundOnly',
});

export default MERCANTILE_SHAPE;
export { MERCANTILE_SHAPE };
