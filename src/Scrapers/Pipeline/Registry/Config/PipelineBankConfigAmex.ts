/**
 * Amex on the ring gateway — the login config and headless endpoints,
 * built from Amex's constants. The login config is the default export
 * (the warm-start canary loads configs that way).
 */

import { buildRingApiDirectCall, buildRingHeadless } from './PipelineBankConfigRing.js';
import { AMEX_RING } from './PipelineBankConfigRingConstants.js';

/** Amex login config — passed to `.withApiDirect(...)`. */
const AMEX_API_DIRECT_CALL = buildRingApiDirectCall(AMEX_RING);

/** Amex headless endpoints. */
const AMEX_HEADLESS = buildRingHeadless(AMEX_RING);

export default AMEX_API_DIRECT_CALL;
export { AMEX_API_DIRECT_CALL, AMEX_HEADLESS };
