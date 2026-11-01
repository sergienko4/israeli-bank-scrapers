/**
 * FIBI-family api-direct login (spec §11.2): one builder per concern, fed a
 * brand record, so each family bank's config is its brand alone. The flow
 * reads the entry page, opens a Transmit session, asserts the password (and
 * the SMS code when the bank asks for one), posts the login form, follows the
 * portal hand-off and trades the SSO code for the authorization header the
 * scrape sends. The device the bank names is remembered, so a known device
 * logs in without a code. Pure data (Rule #11).
 */

import { release, type as osType } from 'node:os';

import type {
  IApiDirectCallConfig,
  IFingerprintConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  FIBI_PATHS,
  FIBI_STATUS_POLICY,
  fibiEntryUrl,
  fibiServletUrl,
  type IFibiBrand,
} from './PipelineBankConfigFibiFamilyConstants.js';
import {
  fibiHandoffSteps,
  fibiPrimeStep,
  fibiSsoSteps,
} from './PipelineBankConfigFibiFamilyPortal.js';
import { fibiAssertSteps, fibiOpeningSteps } from './PipelineBankConfigFibiFamilyTransmit.js';
import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

/** The device as the web SDK reports it, read once at load. */
const DEVICE_DETAILS = {
  os_type: osType(),
  os_version: release(),
  device_model: `Node.js ${process.versions.node}`,
  device_platform: process.platform,
  timezone_offset: new Date().getTimezoneOffset(),
};

/**
 * The SDK's collection result: the app host, the device, no location.
 * @param brand - FIBI-family brand.
 * @returns The fingerprint config.
 */
function fibiFingerprint(brand: IFibiBrand): IFingerprintConfig {
  const { host } = new URL(brand.origin);
  const metadata = { timestamp: { $ref: 'nowMs' }, physical_app_id: { $literal: host } } as const;
  const content = {
    device_details: { $literal: DEVICE_DETAILS },
    location: { $literal: { enabled: false } },
  };
  return { shape: { metadata, content } };
}

/** What every family login shares: the flow, the creds and the carry. */
const FIBI_LOGIN = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  omitBankText: true,
  requiredCreds: { username: 'nonEmpty', password: 'nonEmpty' },
  sessionCarry: ['authorization', 'landingUrl'],
  seedCarryFromCreds: [
    { field: 'flowId', bootstrap: { kind: 'random-hex', bytes: 32, isUpperCase: true } },
  ],
  derivedCarry: [{ into: 'uid', parts: ['creds.username'], transform: 'lower' }],
} as const;

/** What every family headless block shares: native fetch in one cookie session. */
const FIBI_WIRE = {
  nativeFetch: true,
  sessionCookies: true,
  redirectPolicy: 'reject',
  statusPolicy: FIBI_STATUS_POLICY,
  mediaTypes: { json: 'application/json' },
  strictUtf8: true,
} as const;

/**
 * The family login: a fresh upper-case flow id and the lower-case user id
 * open each flow; only the SSO authorization reaches the scrape; the device
 * the bank names is remembered per user.
 * @param brand - FIBI-family brand.
 * @returns The login config.
 */
function buildFibiApiDirectCall(brand: IFibiBrand): IApiDirectCallConfig {
  const { provider } = brand;
  const persistentAuth = {
    kind: 'device-memory',
    provider,
    deviceIdField: 'did',
    accountField: 'username',
  } as const;
  const opening = [fibiPrimeStep(brand), ...fibiOpeningSteps(brand)];
  const portal = [...fibiHandoffSteps(brand), ...fibiSsoSteps(brand)];
  const steps = [...opening, ...fibiAssertSteps(brand), ...portal];
  const fingerprint = fibiFingerprint(brand);
  return { ...FIBI_LOGIN, persistentAuth, fingerprint, steps };
}

/**
 * Each family call's URL on the brand's online origin; the Transmit paths
 * keep their double slash.
 * @param brand - FIBI-family brand.
 * @returns URL tag → absolute URL.
 */
function fibiPaths(brand: IFibiBrand): IHeadlessUrlsConfig['paths'] {
  const { origin } = brand;
  const transmit = {
    'auth.encryptionKey': `${origin}${FIBI_PATHS.keyExchange}`,
    'auth.login': `${origin}${FIBI_PATHS.login}`,
    'auth.assert': `${origin}${FIBI_PATHS.assert}`,
  };
  const sso = {
    'auth.bootstrap': `${origin}${FIBI_PATHS.bootstrap}`,
    'identity.sessionToken': `${origin}${FIBI_PATHS.authorize}`,
  };
  const portal = { 'auth.prime': fibiEntryUrl(brand), 'auth.logon': fibiServletUrl(brand) };
  return { ...portal, ...transmit, ...sso };
}

/**
 * The family's headless block: every call on the brand's online origin,
 * redirects and every 2xx but 200 refused, strict UTF-8.
 * @param brand - FIBI-family brand.
 * @returns The headless block.
 */
function buildFibiHeadless(brand: IFibiBrand): IHeadlessUrlsConfig {
  const base = `${brand.origin}/`;
  const paths = fibiPaths(brand);
  return { identityBase: base, graphql: base, paths, ...FIBI_WIRE };
}

export { buildFibiApiDirectCall, buildFibiHeadless };
