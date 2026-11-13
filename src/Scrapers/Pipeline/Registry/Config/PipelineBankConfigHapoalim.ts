/**
 * Hapoalim direct-API login on the app edge: the call config and the
 * transport URLs. The steps live in their own file; the shared origin,
 * headers and rules in the constants file.
 *
 * <p>The app login is the only flow: it sends the captured RiskMinder
 * device signature as `mfp`, so a registered device lands without an
 * SMS. The web portal flow and its RSA seal are gone.</p>
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { MAX_ACCESS_TOKEN_CHARS } from '../../Mediator/ApiDirectCall/PersistentAuthStateRules.js';
import {
  HAPOALIM_API,
  HAPOALIM_APP_ID,
  HAPOALIM_AUTH_QUERY,
  HAPOALIM_ORIGIN,
  HAPOALIM_STATIC_HEADERS,
} from './PipelineBankConfigHapoalimConstants.js';
import HAPOALIM_DEVICE_SIGNATURE from './PipelineBankConfigHapoalimDeviceSignature.js';
import { HAPOALIM_RESUME_STEP_INDEX, HAPOALIM_STEPS } from './PipelineBankConfigHapoalimSteps.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

/**
 * Fixed values the app forms send. The organization id is the bank's own
 * public constant; the device signature is the captured RiskMinder
 * literal the app sends as `mfp`.
 */
const HAPOALIM_SECRETS: Readonly<Record<string, string>> = {
  organization: '106402333',
  appId: HAPOALIM_APP_ID,
  deviceSignature: HAPOALIM_DEVICE_SIGNATURE,
};

/**
 * Device parameters `step1-mobile` expects. They describe the client, not
 * the user, so they live in the URL with the app id.
 */
const HAPOALIM_STEP1_PARAMS: Readonly<Record<string, string>> = {
  deviceType: 'samsung SM-S918B',
  OSVersion: '34',
  OSType: 'Android',
  versionNumber: '44.3.0',
  deviceTypeCode: '331',
  isRootedDevice: 'false',
};

/** `step1-mobile` query: the app id plus the device parameters. */
const HAPOALIM_STEP1_QUERY = new URLSearchParams({
  appId: HAPOALIM_APP_ID,
  ...HAPOALIM_STEP1_PARAMS,
}).toString();

const HAPOALIM_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  omitBankText: true,
  staticHeaders: HAPOALIM_STATIC_HEADERS,
  requiredCreds: { userCode: 'nonEmpty', password: 'nonEmpty' },
  secrets: HAPOALIM_SECRETS,
  seedCarryFromCreds: [{ field: 'deviceSignature', fallbackSecret: 'deviceSignature' }],
  // The stored token is the app session jar, bound to the user code.
  // `step1-mobile` checks it; a refused session falls back to one cold
  // app login (SMS) that sends none of the stored cookies.
  warmStart: {
    kind: 'cookie-jar',
    credsField: 'otpLongTermToken',
    fromStepIndex: HAPOALIM_RESUME_STEP_INDEX,
    validation: 'bank-call',
    provider: 'hapoalim-app',
    accountField: 'userCode',
    maxTokenChars: MAX_ACCESS_TOKEN_CHARS,
  },
  steps: HAPOALIM_STEPS,
};

const HAPOALIM_TRANSPORT: ITransportConfig = {
  identityBase: `${HAPOALIM_ORIGIN}/`,
  // Hapoalim has no GraphQL; graphql names the data API to satisfy the type.
  graphql: `${HAPOALIM_API}/`,
  paths: {
    'auth.identify': `${HAPOALIM_ORIGIN}/authenticate/init?${HAPOALIM_AUTH_QUERY}`,
    'auth.verify': `${HAPOALIM_ORIGIN}/authenticate/verify?${HAPOALIM_AUTH_QUERY}`,
    'auth.otpInit': `${HAPOALIM_ORIGIN}/authenticate/logonotp/init?${HAPOALIM_AUTH_QUERY}`,
    'auth.otpVerify': `${HAPOALIM_ORIGIN}/authenticate/logonotp/verify?${HAPOALIM_AUTH_QUERY}`,
    'auth.step1': `${HAPOALIM_API}/step1-mobile?${HAPOALIM_STEP1_QUERY}`,
    'auth.arcotid': `${HAPOALIM_ORIGIN}/arcotid/download?${HAPOALIM_AUTH_QUERY}`,
    'auth.stepupInit': `${HAPOALIM_ORIGIN}/stepup/otp/init?${HAPOALIM_AUTH_QUERY}`,
    'auth.stepupVerify': `${HAPOALIM_ORIGIN}/stepup/otp/verify?${HAPOALIM_AUTH_QUERY}`,
    'auth.arcotidAfter': `${HAPOALIM_ORIGIN}/arcotid/download?${HAPOALIM_AUTH_QUERY}`,
  },
  nativeFetch: true,
  sessionCookies: true,
  cookieDomains: ['bankhapoalim.co.il'],
  redirectPolicy: 'reject',
  statusPolicy: { 204: 'empty', 203: 'fail', 206: 'fail', 207: 'fail' },
  omitBankText: HAPOALIM_API_DIRECT_CALL.omitBankText,
};

export default HAPOALIM_API_DIRECT_CALL;
export { HAPOALIM_API_DIRECT_CALL, HAPOALIM_TRANSPORT };
