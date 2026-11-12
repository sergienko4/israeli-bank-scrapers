/**
 * Yahav native login: the call config and the transport URLs. The
 * steps live in their own file; the origin, paths and app constants in the
 * constants file. Every call runs over node:https, which presents the device
 * certificate the login registers to the mobile origin alone.
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { MAX_ACCESS_TOKEN_CHARS } from '../../Mediator/ApiDirectCall/PersistentAuthStateRules.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';
import { YAHAV_AUTH_PATHS, YAHAV_NATIVE_ORIGIN } from './PipelineBankConfigYahavConstants.js';
import { YAHAV_RESUME_STEP_INDEX, YAHAV_STEPS } from './PipelineBankConfigYahavSteps.js';

const YAHAV_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'bearer',
  omitBankText: true,
  requiredCreds: { num: 'latin1', nationalID: 'digits', password: 'latin1' },
  sessionCarry: ['mag'],
  cookieHandoff: 'isolate',
  authRecovery: 'whole-scrape',
  // The stored token is the device bundle, bound to the user. The token call
  // checks it; a refused bundle falls back to one cold login (SMS).
  warmStart: {
    kind: 'carry-bundle',
    credsField: 'otpLongTermToken',
    fromStepIndex: YAHAV_RESUME_STEP_INDEX,
    validation: 'bank-call',
    provider: 'yahav-native',
    accountFields: ['num', 'nationalID'],
    slots: ['clientId', 'clientSecret', 'certKeyPem', 'certPem', 'mag'],
    maxTokenChars: MAX_ACCESS_TOKEN_CHARS,
    cookies: true,
    coldFallback: 'auth-rejected',
  },
  steps: YAHAV_STEPS,
};

const YAHAV_TRANSPORT: ITransportConfig = {
  identityBase: `${YAHAV_NATIVE_ORIGIN}/`,
  // Yahav has no GraphQL; graphql names the native origin to satisfy the type.
  graphql: `${YAHAV_NATIVE_ORIGIN}/`,
  paths: {
    'auth.prime': `${YAHAV_NATIVE_ORIGIN}${YAHAV_AUTH_PATHS.initialize}`,
    'auth.bind': `${YAHAV_NATIVE_ORIGIN}${YAHAV_AUTH_PATHS.register}`,
    'auth.logon': `${YAHAV_NATIVE_ORIGIN}${YAHAV_AUTH_PATHS.token}`,
  },
  clientCert: { mode: 'dynamic', origin: YAHAV_NATIVE_ORIGIN },
  sessionCookies: true,
  cookieDomains: ['yahav.co.il'],
};

export default YAHAV_API_DIRECT_CALL;
export { YAHAV_API_DIRECT_CALL, YAHAV_TRANSPORT };
