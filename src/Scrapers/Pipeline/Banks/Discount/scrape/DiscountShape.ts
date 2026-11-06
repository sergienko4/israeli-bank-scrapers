/**
 * Discount (Telebank group) scrape shape — the `IApiDirectScrapeShape` data
 * declaration consumed by the generic buildGenericHeadlessScrape driver via
 * `withApiDirect`. balanceKind=account.
 *
 * The family wiring — the Titan URLs, the routing headers, the answer check
 * and the extractors — comes from the neutral TelebankGroup factory; this
 * module supplies what is Discount's own: its step name and its
 * coverage-backfill stance. The stance stays declared here, not inherited,
 * so the WINDOW-CANARY gate keeps seeing a conscious per-bank decision.
 */

import { makeTelebankGroupShape } from '../../../Phases/ApiDirectScrape/TelebankGroup/TelebankGroupShape.js';

/** Discount hard-model shape — passed to `.withApiDirect(...)`. */
const DISCOUNT_SHAPE = makeTelebankGroupShape({
  stepName: 'DiscountScrape',
  windowNarrowing: 'lowerBoundOnly',
});

export default DISCOUNT_SHAPE;
export { DISCOUNT_SHAPE };
