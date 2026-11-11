/**
 * Isracard on the ring gateway — the login config and headless endpoints,
 * built from Isracard's constants. The login config is the default export
 * (the warm-start canary loads configs that way).
 */

import { buildRingApiDirectCall, buildRingHeadless } from './PipelineBankConfigRing.js';
import { ISRACARD_RING } from './PipelineBankConfigRingConstants.js';

/** Isracard login config — passed to `.withApiDirect(...)`. */
const ISRACARD_API_DIRECT_CALL = buildRingApiDirectCall(ISRACARD_RING);

/** Isracard headless endpoints. */
const ISRACARD_TRANSPORT = buildRingHeadless(ISRACARD_RING);

export default ISRACARD_API_DIRECT_CALL;
export { ISRACARD_API_DIRECT_CALL, ISRACARD_TRANSPORT };
