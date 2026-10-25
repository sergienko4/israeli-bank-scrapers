/**
 * OneZero headless registry block — isolated so the central registry stays
 * under its file cap, and so the app identity the edge checks lives in one
 * place.
 *
 * The identity and GraphQL hosts (`*.tfd-bank.com`) sit behind a Cloudflare
 * WAF that admits a request only when it carries all three parts of the
 * Android app's identity: the app's mTLS client certificate, the Android
 * OkHttp/Conscrypt TLS ClientHello, and the app's User-Agent. Dropping any
 * one returns a 403 Cloudflare block page before the request reaches the app.
 * Canary: `Tests/Unit/Pipeline/Registry/Config/PipelineBankConfigOneZeroWaf.test.ts`.
 */

import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

/**
 * User-Agent of the OneZero Android app (version 4.7.0, build 564). The WAF
 * matches it on identity and GraphQL calls alike, so the identity login steps
 * (`staticHeaders`) and the GraphQL transport (`graphqlHeaders`) both send it.
 * Bump it with the app version if the edge starts rejecting this one.
 */
const ONEZERO_USER_AGENT = 'ONEZEROIL/4.7.0(564) Lokalize/0 (Android 11 ; Pixel 3) MTLS';

/** OneZero headless identity, GraphQL and auth endpoints plus transport identity. */
const ONEZERO_HEADLESS: IHeadlessUrlsConfig = {
  identityBase: 'https://identity.tfd-bank.com/v1/',
  graphql: 'https://mobile.tfd-bank.com/mobile-graph/graphql',
  paths: {
    'identity.deviceToken': 'https://identity.tfd-bank.com/v1/devices/token',
    'identity.otpPrepare': 'https://identity.tfd-bank.com/v1/otp/prepare',
    'identity.otpVerify': 'https://identity.tfd-bank.com/v1/otp/verify',
    'identity.getIdToken': 'https://identity.tfd-bank.com/v1/getIdToken',
    'identity.sessionToken': 'https://identity.tfd-bank.com/v1/sessions/token',
  },
  graphqlHeaders: { 'User-Agent': ONEZERO_USER_AGENT },
  requiresClientCert: true,
  tlsProfile: 'android-11-okhttp',
  phoneNumberFormat: 'international-plus',
};

export default ONEZERO_HEADLESS;
export { ONEZERO_HEADLESS, ONEZERO_USER_AGENT };
