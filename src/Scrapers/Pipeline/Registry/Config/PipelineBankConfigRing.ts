/**
 * Ring factory — the login config and headless endpoints for an issuer on
 * the ring mobile gateway. Issuers differ only in their constants
 * (`IRingConstants`); everything else is shared.
 *
 * The session is a cookie plus the bank's `bcKey`, not an auth header, so
 * the scheme is `'none'` and the node transport keeps the run's cookies.
 * The device id (`udid`) is derived from the ID number, so every run of one
 * user presents the same device; `bcKey` starts as a fresh UUID and is
 * replaced when the bank issues one. `userName` starts empty and is filled
 * when a response supplies it — a warm run skips the step that would.
 *
 * Warm path: `creds.otpLongTermToken` is the device key from a past run.
 * The run resumes at the key sign-in, which the bank itself validates. The
 * key does not rotate, so it is returned as `result.persistentOtpToken`.
 */

import type {
  IApiDirectCallConfig,
  ISeedCarrySource,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { type IRingConstants, ringStaticHeaders } from './PipelineBankConfigRingConstants.js';
import { buildRingSteps, RING_WARM_STEP_INDEX } from './PipelineBankConfigRingSteps.js';
import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

/** Carry slots seeded before the first step. */
const RING_SEEDS: readonly ISeedCarrySource[] = [
  { field: 'udid', bootstrap: { kind: 'sha256-prefix-16', from: 'id' } },
  { field: 'bcKey', bootstrap: { kind: 'random-uuid' } },
];

/** The parts of the login config every issuer shares. */
const RING_SHARED = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  requiredCreds: { id: 'digits', card6Digits: 'sixDigits', password: 'nonEmpty' },
  seedCarryFromCreds: RING_SEEDS,
  derivedCarry: [{ into: 'userName', parts: [] }],
  warmStart: {
    credsField: 'otpLongTermToken',
    carryField: 'key',
    fromStepIndex: RING_WARM_STEP_INDEX,
    validation: 'bank-call',
  },
} as const satisfies Omit<IApiDirectCallConfig, 'steps'>;

/**
 * Build an issuer's login config — passed to `.withApiDirect(...)`.
 * @param ring - Issuer constants.
 * @returns Login config.
 */
function buildRingApiDirectCall(ring: IRingConstants): IApiDirectCallConfig {
  const staticHeaders = ringStaticHeaders(ring);
  const steps = buildRingSteps(ring);
  return { ...RING_SHARED, staticHeaders, steps };
}

/**
 * Build an issuer's headless endpoints. Every login step posts to one
 * `service` URL and names its bank service in the query string.
 * @param ring - Issuer constants.
 * @returns Headless endpoints.
 */
function buildRingHeadless(ring: IRingConstants): IHeadlessUrlsConfig {
  const identityBase = `${ring.base}/`;
  const paths = { 'auth.service': `${ring.base}/service` };
  // The ring has no GraphQL; graphql mirrors identityBase to satisfy the type.
  const graphql = identityBase;
  // The ring answers a plain Node client; its session rides on cookies.
  return { identityBase, graphql, paths, nativeFetch: true, sessionCookies: true };
}

export { buildRingApiDirectCall, buildRingHeadless };
