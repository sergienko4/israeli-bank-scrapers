/**
 * FIBI-family api-direct login: one builder per concern, fed a
 * brand record, so each family bank's config is its brand alone. The flow
 * opens a Transmit session, asserts the password (and the SMS code when the
 * bank asks for one), posts the static login form, then trades the SSO code
 * for the authorization header the scrape sends. No portal page is read, so
 * the login does not depend on the HTML host that bot protection guards. The
 * device the bank names is remembered, so a known device logs in without a
 * code. Pure data (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  FIBI_PATHS,
  FIBI_STATUS_POLICY,
  fibiServletUrl,
  type IFibiBrand,
} from './PipelineBankConfigFibiFamilyConstants.js';
import { fibiLogonStep, fibiSsoSteps } from './PipelineBankConfigFibiFamilyPortal.js';
import { fibiAssertSteps, fibiOpeningSteps } from './PipelineBankConfigFibiFamilyTransmit.js';
import deviceFingerprint from './PipelineBankConfigRuntimeFingerprint.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

/** What every family login shares: the flow, the creds and the carry. */
const FIBI_LOGIN = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  omitBankText: true,
  requiredCreds: { username: 'nonEmpty', password: 'nonEmpty' },
  sessionCarry: ['authorization'],
  seedCarryFromCreds: [
    { field: 'flowId', bootstrap: { kind: 'random-hex', bytes: 32, isUpperCase: true } },
  ],
  derivedCarry: [{ into: 'uid', parts: ['creds.username'], transform: 'lower' }],
} as const;

/** What every family transport block shares: native fetch in one cookie session. */
const FIBI_WIRE = {
  nativeFetch: true,
  sessionCookies: true,
  redirectPolicy: 'reject',
  statusPolicy: FIBI_STATUS_POLICY,
  mediaTypes: { json: 'application/json' },
  strictUtf8: true,
} as const;

/**
 * Build the per-user device-memory persistence block for a FIBI brand.
 * @param brand - FIBI-family brand.
 * @returns Device-memory persistentAuth config.
 */
function fibiDeviceMemory(brand: IFibiBrand): NonNullable<IApiDirectCallConfig['persistentAuth']> {
  return {
    kind: 'device-memory',
    provider: brand.provider,
    deviceIdField: 'did',
    accountField: 'username',
  };
}

/**
 * Assemble the ordered login, OTP assertion, portal handoff and SSO steps.
 * @param brand - FIBI-family brand.
 * @returns Full login step sequence for the brand.
 */
function fibiLoginSteps(brand: IFibiBrand): IApiDirectCallConfig['steps'] {
  return [
    ...fibiOpeningSteps(brand),
    ...fibiAssertSteps(brand),
    fibiLogonStep(brand),
    ...fibiSsoSteps(brand),
  ];
}

/**
 * The family login: a fresh upper-case flow id and the lower-case user id
 * open each flow; only the SSO authorization reaches the scrape; the device
 * the bank names is remembered per user.
 * @param brand - FIBI-family brand.
 * @returns The login config.
 */
function buildFibiApiDirectCall(brand: IFibiBrand): IApiDirectCallConfig {
  const persistentAuth = fibiDeviceMemory(brand);
  const steps = fibiLoginSteps(brand);
  const fingerprint = deviceFingerprint(brand.origin);
  return { ...FIBI_LOGIN, persistentAuth, fingerprint, steps };
}

/**
 * Build the Transmit and SSO endpoint URLs rooted on the brand origin.
 * @param origin - Brand online origin.
 * @returns Transmit and SSO URL map.
 */
function fibiOriginPaths(origin: string): Readonly<Record<string, string>> {
  return {
    'auth.encryptionKey': `${origin}${FIBI_PATHS.keyExchange}`,
    'auth.login': `${origin}${FIBI_PATHS.login}`,
    'auth.assert': `${origin}${FIBI_PATHS.assert}`,
    'auth.bootstrap': `${origin}${FIBI_PATHS.bootstrap}`,
    'identity.sessionToken': `${origin}${FIBI_PATHS.authorize}`,
  };
}

/**
 * Each family call's URL on the brand's online origin; the Transmit paths
 * keep their double slash.
 * @param brand - FIBI-family brand.
 * @returns URL tag → absolute URL.
 */
function fibiPaths(brand: IFibiBrand): ITransportConfig['paths'] {
  const portal = { 'auth.logon': fibiServletUrl(brand) };
  const api = fibiOriginPaths(brand.origin);
  return { ...portal, ...api };
}

/**
 * The family's transport block: every call on the brand's online origin,
 * redirects and every 2xx but 200 refused, strict UTF-8.
 * @param brand - FIBI-family brand.
 * @returns The transport block.
 */
function buildFibiHeadless(brand: IFibiBrand): ITransportConfig {
  const base = `${brand.origin}/`;
  const paths = fibiPaths(brand);
  return { identityBase: base, graphql: base, paths, ...FIBI_WIRE };
}

export { buildFibiApiDirectCall, buildFibiHeadless };
