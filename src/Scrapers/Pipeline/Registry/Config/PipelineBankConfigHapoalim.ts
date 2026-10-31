/**
 * Hapoalim direct-API login: the call config and the headless URLs. The steps
 * live in their own file; the shared origin, headers and rules in the
 * constants file.
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  HAPOALIM_API,
  HAPOALIM_LOGIN_PAGE,
  HAPOALIM_ORIGIN,
  HAPOALIM_STATIC_HEADERS,
} from './PipelineBankConfigHapoalimConstants.js';
import { HAPOALIM_STEPS } from './PipelineBankConfigHapoalimSteps.js';
import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

/**
 * Fixed values the login forms send. The organization id and the key wrap
 * are the bank's own public constants; `null` is sent as text.
 */
const HAPOALIM_SECRETS: Readonly<Record<string, string>> = {
  organization: '106402333',
  wrapPrefix: '3ba782e1967c24a2',
  wrapSuffix: '3ba782e1',
  nullLiteral: 'null',
};

const HAPOALIM_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  omitBankText: true,
  staticHeaders: HAPOALIM_STATIC_HEADERS,
  requiredCreds: { userCode: 'nonEmpty', password: 'nonEmpty' },
  secrets: HAPOALIM_SECRETS,
  steps: HAPOALIM_STEPS,
};

const HAPOALIM_HEADLESS: IHeadlessUrlsConfig = {
  identityBase: `${HAPOALIM_ORIGIN}/`,
  // Hapoalim has no GraphQL; graphql names the data API to satisfy the type.
  graphql: `${HAPOALIM_API}/`,
  paths: {
    'auth.bootstrap': HAPOALIM_LOGIN_PAGE,
    'auth.encryptionKey': `${HAPOALIM_ORIGIN}/ng-portals/auth/serial-number`,
    'auth.identify': `${HAPOALIM_ORIGIN}/authenticate/init`,
    'auth.verify': `${HAPOALIM_ORIGIN}/authenticate/verify`,
    'auth.otpInit': `${HAPOALIM_ORIGIN}/authenticate/logonotp/init`,
    'auth.otpVerify': `${HAPOALIM_ORIGIN}/authenticate/logonotp/verify`,
    'auth.landing': `${HAPOALIM_API}/landing-page?action=init`,
  },
  nativeFetch: true,
  sessionCookies: true,
  cookieDomains: ['bankhapoalim.co.il'],
  redirectPolicy: 'reject',
  statusPolicy: { 204: 'empty', 203: 'fail', 206: 'fail', 207: 'fail' },
};

export default HAPOALIM_API_DIRECT_CALL;
export { HAPOALIM_API_DIRECT_CALL, HAPOALIM_HEADLESS };
