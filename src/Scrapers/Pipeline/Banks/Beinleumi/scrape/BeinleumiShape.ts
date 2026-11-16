/**
 * Beinleumi (FIBI group) scrape shape — the family factory bound to the brand's
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
import makeFibiGroupShape from '../../../Banks/_Shared/FibiGroup/FibiGroupShape.js';
import { BEINLEUMI_BRAND } from '../../../Registry/Config/PipelineBankConfigBeinleumi.js';

/** Beinleumi hard-model shape — passed to `.withApiDirect(...)`. */
const BEINLEUMI_SHAPE = makeFibiGroupShape({
  brand: BEINLEUMI_BRAND,
  stepName: 'BeinleumiScrape',
  windowNarrowing: 'windowEnd',
});

export default BEINLEUMI_SHAPE;
