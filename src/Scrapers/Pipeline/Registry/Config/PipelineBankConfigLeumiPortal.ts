/**
 * Leumi's token-bound portal authentication.
 */

import type {
  IJwtClaimsCapture,
  IPostStep,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  COMMON_HEADERS,
  ENTRY_RULES,
  LEUMI_JWT_CAPTURE,
  ORIGIN,
  SSO,
  SSO_RULES,
} from './PipelineBankConfigLeumiPortalPolicies.js';
import LEUMI_SSO_STEPS from './PipelineBankConfigLeumiPortalSso.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

const USER_REF = 'creds.username';
const AUTHENTICATE: IPostStep = {
  name: 'identify',
  urlTag: 'auth.identify',
  encoding: 'form-text-utf8',
  body: {
    shape: {
      password: { $ref: 'carry.token' },
      authType: { $literal: '2' },
      uid: { $ref: USER_REF },
      trackingCode: { $ref: 'carry.trackingCode' },
      Language: { $ref: 'carry.langNum' },
      appId: { $literal: 'webapp' },
    },
  },
  headers: {
    ...COMMON_HEADERS,
    ...literalHeaders({ origin: ORIGIN, pragma: 'no-cache', 'cache-control': 'no-cache' }),
    'x-uid': { $ref: USER_REF },
  },
  mediaType: 'text/html',
  extractsToCarry: { authenticateLanding: '/LandingPage' },
  deriveCarry: [
    {
      into: 'ssoUrl',
      parts: ['carry.authenticateLanding', 'carry.gatekeeperUrl', USER_REF],
      op: {
        kind: 'url-compose',
        base: ORIGIN,
        path: SSO,
        source: SSO_RULES,
        url: SSO_RULES,
        merge: {
          source: ENTRY_RULES,
          requiredKeys: ['trackingCode', 'sysNum', 'langNum'],
          setKey: 'userId',
        },
      },
    },
  ],
  responseIntegrity: { maxBytes: 262144 },
};
const SPECIAL_CAPTURE: IJwtClaimsCapture = {
  ...LEUMI_JWT_CAPTURE,
  captures: {
    ...LEUMI_JWT_CAPTURE.captures,
    jti: { pointer: '/jti', maxChars: 512, rejectBlank: true },
  },
};
const LEUMI_PORTAL_STEPS: readonly IStepConfig[] = [
  { ...AUTHENTICATE, runIf: { carry: 'site', oneOf: ['01'] } },
  {
    ...AUTHENTICATE,
    runIf: { carry: 'site', oneOf: ['40', '70'] },
    structuredCapture: SPECIAL_CAPTURE,
  },
  ...LEUMI_SSO_STEPS,
];

export {
  LEUMI_JWT_CAPTURE,
  LEUMI_PORTAL_PATHS,
  LEUMI_PORTAL_SEEDS,
  LEUMI_SITE_GUARD,
  LEUMI_STATUS_POLICY,
} from './PipelineBankConfigLeumiPortalPolicies.js';
export { LEUMI_PORTAL_STEPS };
