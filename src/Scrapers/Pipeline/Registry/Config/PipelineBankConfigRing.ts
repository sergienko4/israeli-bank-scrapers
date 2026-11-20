/**
 * Ring factory — the login config and transport endpoints for an issuer on
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
 * Warm path: `creds.otpLongTermToken` is the carry bundle from a past run —
 * the device key plus the session jar. The run resumes at the key sign-in,
 * which the bank itself validates. The key does not rotate, so it is
 * returned inside the next bundle as `result.persistentOtpToken`.
 */

import type {
  IApiDirectCallConfig,
  ICarryBundleWarmStart,
  ISeedCarrySource,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { type IRingConstants, ringStaticHeaders } from './PipelineBankConfigRingConstants.js';
import { buildRingSteps, RING_WARM_STEP_INDEX } from './PipelineBankConfigRingSteps.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

/** Carry slots seeded before the first step. */
const RING_SEEDS: readonly ISeedCarrySource[] = [
  { field: 'udid', bootstrap: { kind: 'sha256-prefix-16', from: 'id' } },
  { field: 'bcKey', bootstrap: { kind: 'random-uuid' } },
];

/** Transport settings every ring issuer shares. */
const RING_TRANSPORT_PROFILE = {
  tlsProfile: 'openssl-http1',
  sessionCookies: true,
} as const;

/**
 * Largest warm token the ring publishes. A cookie bundle is larger than a
 * bare key but stays well under this cap; the same 16 KiB ceiling guards
 * every stored API token.
 */
const RING_MAX_TOKEN_CHARS = 16_384;

/**
 * The warm token is the device key plus the session jar the cold login
 * earned. The ring edge challenges a key-only resume on some Cloudflare
 * PoPs; the app keeps the same cookies between launches, so the token does
 * too. A token from an older release fails the bundle check and falls back
 * to one cold login, which re-registers the same device key.
 */
const RING_WARM: Omit<ICarryBundleWarmStart, 'provider'> = {
  kind: 'carry-bundle',
  credsField: 'otpLongTermToken',
  fromStepIndex: RING_WARM_STEP_INDEX,
  validation: 'bank-call',
  accountFields: ['id', 'card6Digits'],
  slots: ['key'],
  maxTokenChars: RING_MAX_TOKEN_CHARS,
  cookies: true,
  coldFallback: 'any',
};

/** What a Ring warm config looks like before the provider tag is added. */
type RingWarmStart = Omit<ICarryBundleWarmStart, 'provider'>;

/** The parts of the login config every issuer shares. */
const RING_SHARED = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  requiredCreds: { id: 'digits', card6Digits: 'sixDigits', password: 'nonEmpty' },
  seedCarryFromCreds: RING_SEEDS,
  derivedCarry: [{ into: 'userName', parts: [] }],
  warmStart: RING_WARM,
} as const satisfies Omit<IApiDirectCallConfig, 'steps' | 'warmStart'> & {
  warmStart: RingWarmStart;
};

/**
 * Build an issuer's login config — passed to `.withApiDirect(...)`.
 * @param ring - Issuer constants.
 * @returns Login config.
 */
function buildRingApiDirectCall(ring: IRingConstants): IApiDirectCallConfig {
  const staticHeaders = ringStaticHeaders(ring);
  const steps = buildRingSteps(ring);
  const warmStart = { ...RING_SHARED.warmStart, provider: ring.isrdomain };
  return { ...RING_SHARED, staticHeaders, steps, warmStart };
}

/**
 * Build an issuer's transport endpoints. Every login step posts to one
 * `service` URL and names its bank service in the query string.
 * @param ring - Issuer constants.
 * @returns Transport endpoints.
 */
function buildRingTransport(ring: IRingConstants): ITransportConfig {
  const identityBase = `${ring.base}/`;
  const paths = { 'auth.service': `${ring.base}/service` };
  // The ring has no GraphQL; graphql mirrors identityBase to satisfy the type.
  const graphql = identityBase;
  // The domain jar lets the warm bundle keep the session cookies.
  const cookieDomains = [ring.cookieDomain];
  return { identityBase, graphql, paths, ...RING_TRANSPORT_PROFILE, cookieDomains };
}

export { buildRingApiDirectCall, buildRingTransport };
