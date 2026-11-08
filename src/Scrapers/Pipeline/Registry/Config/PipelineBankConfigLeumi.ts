/**
 * Leumi's native login and headless transport configuration.
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  LEUMI_BOOTSTRAP_PATHS,
  LEUMI_BOOTSTRAP_STEPS,
} from './PipelineBankConfigLeumiBootstrap.js';
import {
  LEUMI_PORTAL_PATHS,
  LEUMI_PORTAL_SEEDS,
  LEUMI_PORTAL_STEPS,
  LEUMI_STATUS_POLICY,
} from './PipelineBankConfigLeumiPortal.js';
import {
  LEUMI_TRANSMIT_PATHS,
  LEUMI_TRANSMIT_SEEDS,
  LEUMI_TRANSMIT_STEPS,
} from './PipelineBankConfigLeumiTransmit.js';
import deviceFingerprint from './PipelineBankConfigRuntimeFingerprint.js';
import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

const ORIGIN = 'https://hb2.bankleumi.co.il';
const LEUMI_API_DIRECT_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  omitBankText: true,
  requiredCreds: { username: 'nonEmpty', password: 'nonEmpty' },
  sessionCarry: ['sessionToken'],
  secrets: { language: 'he' },
  fingerprint: deviceFingerprint(ORIGIN),
  seedCarryFromCreds: [...LEUMI_TRANSMIT_SEEDS, ...LEUMI_PORTAL_SEEDS],
  steps: [...LEUMI_BOOTSTRAP_STEPS, ...LEUMI_TRANSMIT_STEPS, ...LEUMI_PORTAL_STEPS],
};
const LEUMI_HEADLESS: IHeadlessUrlsConfig = {
  identityBase: ORIGIN,
  graphql: `${ORIGIN}/`,
  paths: { ...LEUMI_BOOTSTRAP_PATHS, ...LEUMI_TRANSMIT_PATHS, ...LEUMI_PORTAL_PATHS },
  nativeFetch: true,
  isConnectRetryDisabled: true,
  sessionCookies: true,
  cookieDomains: ['bankleumi.co.il'],
  redirectPolicy: 'reject',
  statusPolicy: { ...LEUMI_STATUS_POLICY, 429: 'rate-limit' },
  omitBankText: true,
  mediaTypes: { json: 'application/json' },
  strictUtf8: true,
  responseIntegrity: { maxBytes: 4194304 },
};

export { LEUMI_API_DIRECT_CALL, LEUMI_HEADLESS };
