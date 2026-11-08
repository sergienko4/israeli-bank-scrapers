/**
 * Leumi token binding and portal URL policies.
 */

import type {
  IDerivedCarry,
  IJwtClaimsCapture,
  ISeedCarrySource,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { CLIENT_PROFILE } from './PipelineBankConfigLeumiBootstrap.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

const ORIGIN = 'https://hb2.bankleumi.co.il';
const GATE = '/staticcontent/gate-keeper/';
const SSO = '/Ebanking/SSOLogin.aspx';
const SPA = '/eBanking/SO/SPA.aspx';
const PAGE_LIMIT = 2097152;
const LEUMI_PORTAL_PATHS = {
  'auth.identify': `${ORIGIN}/authenticate`,
  'auth.logon': `${ORIGIN}${SSO}`,
  'identity.sessionToken': `${ORIGIN}${SPA}`,
} as const;
const ENTRY_RULES = [
  { origin: ORIGIN, paths: [`${GATE}he/`], query: { sysNum: '23', langNum: '1' } },
  { origin: ORIGIN, paths: [`${GATE}en/`], query: { sysNum: '23', langNum: '2' } },
] as const;
const SSO_RULES = [{ origin: ORIGIN, paths: [SSO] }] as const;
const SPA_RULES = [{ origin: ORIGIN, paths: [SPA] }] as const;
const LEUMI_JWT_CAPTURE: IJwtClaimsCapture = {
  kind: 'jwt-claims',
  from: 'token',
  maxTokenChars: 32768,
  equals: {
    '/IdBlockObject/LeumiAuth/Uid': 'creds.username',
    '/params/trackingCode': 'carry.trackingCode',
    '/params/sysNum': 'carry.sysNum',
    '/params/langNum': 'carry.langNum',
  },
  captures: { issuedSite: { pointer: '/IdBlockObject/LeumiAuth/Site', maxChars: 2 } },
};
const LEUMI_SITE_GUARD: readonly IDerivedCarry[] = [
  {
    into: 'site',
    parts: ['carry.issuedSite'],
    op: {
      kind: 'format',
      rules: [
        { pattern: '01', prefix: '' },
        { pattern: '40', prefix: '' },
        { pattern: '70', prefix: '' },
      ],
    },
  },
];
const LEUMI_PORTAL_SEEDS: readonly ISeedCarrySource[] = [
  { field: 'messageId', bootstrap: { kind: 'random-uuid' }, alwaysBootstrap: true },
  { field: 'transactionId', bootstrap: { kind: 'random-uuid' }, alwaysBootstrap: true },
];
const COMMON_HEADERS = {
  ...literalHeaders({
    accept: '*/*',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    ...CLIENT_PROFILE,
  }),
  referer: { $ref: 'carry.gatekeeperUrl' },
} as const;

export {
  COMMON_HEADERS,
  ENTRY_RULES,
  LEUMI_JWT_CAPTURE,
  LEUMI_PORTAL_PATHS,
  LEUMI_PORTAL_SEEDS,
  LEUMI_SITE_GUARD,
  ORIGIN,
  PAGE_LIMIT,
  SPA_RULES,
  SSO,
  SSO_RULES,
};
export { default as LEUMI_STATUS_POLICY } from './PipelineBankConfigHttpStatus.js';
