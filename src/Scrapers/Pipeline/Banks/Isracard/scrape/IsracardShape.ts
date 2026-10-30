/**
 * Isracard scrape shape — the `IApiDirectScrapeShape` data declaration
 * consumed by the generic API-direct scrape driver.
 * balanceKind=card-cycle (the card's next statement debit).
 *
 * Isracard runs the ring app API, so the family wiring — envelope, headers,
 * the body check that fails an unconfirmed reply, extractors — comes from the
 * neutral Ring factory; this module supplies what is Isracard's own: its ring
 * constants, its step name, and its coverage-backfill stance.
 *
 * The stance stays declared here, not inherited, so the WINDOW-CANARY gate
 * keeps seeing a conscious per-bank decision.
 */

import { makeRingShape } from '../../../Phases/ApiDirectScrape/Ring/RingShape.js';
import { ISRACARD_RING } from '../../../Registry/Config/PipelineBankConfigRingConstants.js';

/** Isracard hard-model shape. */
const ISRACARD_SHAPE = makeRingShape({
  stepName: 'IsracardScrape',
  windowNarrowing: 'periodEnumeration',
  ring: ISRACARD_RING,
});

export default ISRACARD_SHAPE;
export { ISRACARD_SHAPE };
