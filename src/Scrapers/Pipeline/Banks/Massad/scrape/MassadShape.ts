/**
 * Massad (FIBI group) scrape shape — the family factory bound to the brand's
 * own registry record. The origin comes from the same `IFibiBrand` the login
 * config uses, so the scrape and the authenticated session can never point at
 * different hosts.
 *
 * Account identity spans two cookie-authed GETs (`userData` plus the
 * session-level `accountType` lookup); balance is a GET and transactions a
 * single full-window POST. The family factory owns the envelope, identity
 * merge and extractors; this file supplies the brand record, step name and
 * coverage-backfill stance.
 */
import makeFibiGroupShape from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShape.js';
import { MASSAD_BRAND } from '../../../Registry/Config/PipelineBankConfigMassad.js';

/** Massad hard-model shape — passed to `.withApiDirect(...)`. */
const MASSAD_SHAPE = makeFibiGroupShape({
  brand: MASSAD_BRAND,
  stepName: 'MassadScrape',
  windowNarrowing: 'windowEnd',
});

export default MASSAD_SHAPE;
