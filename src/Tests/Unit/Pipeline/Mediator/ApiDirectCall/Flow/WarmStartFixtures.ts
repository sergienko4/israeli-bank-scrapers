/**
 * WarmStartFixtures — the warm-start config and JWT shapes shared by the
 * ApiDirectCall warm-path suites.
 *
 * These live here rather than in each suite because the two configs encode a
 * non-obvious contract: `fromStepIndex` is the resume point, so the
 * single-step `warmConfig` lands past the end of the step list and the warm
 * path short-circuits without ever contacting the bank. A suite that needs a
 * warm request to actually happen — and therefore to be able to fail — must
 * use `warmTwoStepConfig`. Duplicating that subtlety per suite is how a test
 * ends up silently asserting nothing.
 */

import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';

/** URL group the warm fixtures resolve their single step against. */
const WARM_STEP_TAG: WKUrlGroup = 'auth.assert';

/**
 * Build a synthetic JWT with a configurable `exp` claim offset.
 * @param deltaSec - Seconds from now for the exp claim (negative = stale).
 * @returns Compact JWT.
 */
function makeJwt(deltaSec: number): string {
  const headerJson = JSON.stringify({ alg: 'none' });
  const headerEnc = Buffer.from(headerJson).toString('base64url');
  const expSec = Math.floor(Date.now() / 1000) + deltaSec;
  const payloadJson = JSON.stringify({ exp: expSec });
  const payloadEnc = Buffer.from(payloadJson).toString('base64url');
  return `${headerEnc}.${payloadEnc}.sig`;
}

/**
 * Build the warm+jwtClaims config used by every case (single cold step).
 * @returns API-direct-call config literal.
 */
function warmConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: { queryTag: 'customer' },
    warmStart: { credsField: 'otpLongTermToken', carryField: 'token', fromStepIndex: 1 },
    jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
    steps: [
      {
        name: 'getIdToken',
        urlTag: WARM_STEP_TAG,
        body: { shape: {} },
        extractsToCarry: { token: '/access_token' },
      },
    ],
  };
}

/**
 * Same warm contract, but with a step ahead of the resume point so the warm
 * path actually issues a request and can therefore actually fail.
 * @returns API-direct-call config whose warm resume costs one request.
 */
function warmTwoStepConfig(): IApiDirectCallConfig {
  const base = warmConfig();
  const resumed = base.steps[0];
  return { ...base, steps: [resumed, ...base.steps] };
}

export { makeJwt, WARM_STEP_TAG, warmConfig, warmTwoStepConfig };
