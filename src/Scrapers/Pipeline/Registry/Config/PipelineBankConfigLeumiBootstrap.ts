/**
 * Leumi's public entry, gatekeeper, pinned SDK and session reset.
 */

import type { IGetStep, IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IUrlRule } from '../../Types/Domain/FetchPolicy.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

const ORIGIN = 'https://hb2.bankleumi.co.il';
const GATE = '/staticcontent/gate-keeper/';
const SDK = `${GATE}js/transmit/8.1/xmsdk.js`;
const PAGE_LIMIT = 2097152;
const SDK_LIMIT = 1048576;
const SDK_SHA256 = 'eed80083c330d781f00e36e2793ae5704314b8aa4519c098511970b3507906bf';
const ENTRY_REF = 'carry.entryUrl';
const CLIENT_PROFILE = {
  'accept-language': 'he-IL',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
} as const;

const LEUMI_BOOTSTRAP_PATHS = {
  'auth.prime': `${ORIGIN}/H/Login.html`,
  'auth.landing': `${ORIGIN}${GATE}`,
  'auth.service': `${ORIGIN}${SDK}`,
  'auth.logout': `${ORIGIN}/vdesk/hangup.php3`,
} as const;

const ENTRY_RULES: readonly IUrlRule[] = [
  { origin: ORIGIN, paths: [GATE, `${GATE}he/`], query: { sysNum: '23', langNum: '1' } },
  { origin: ORIGIN, paths: [GATE, `${GATE}en/`], query: { sysNum: '23', langNum: '2' } },
];
const GATE_RULES: readonly IUrlRule[] = [
  { origin: ORIGIN, paths: [`${GATE}he/`], query: { sysNum: '23', langNum: '1' } },
  { origin: ORIGIN, paths: [`${GATE}en/`], query: { sysNum: '23', langNum: '2' } },
];
const SDK_RULES: readonly IUrlRule[] = [{ origin: ORIGIN, paths: [SDK] }];
const HANGUP_RULES: readonly IUrlRule[] = [{ origin: ORIGIN, paths: ['/vdesk/hangup.php3'] }];
const HTML = {
  response: 'text',
  maxTextChars: PAGE_LIMIT,
  mediaType: 'text/html',
  responseIntegrity: { maxBytes: PAGE_LIMIT },
} as const;
const PAGE_HEADERS = literalHeaders({ accept: 'text/html', ...CLIENT_PROFILE });

const ENTRY: IGetStep = {
  name: 'prime',
  urlTag: 'auth.prime',
  method: 'GET',
  extractsToCarry: {},
  headers: PAGE_HEADERS,
  setCookies: { i18next: 'config.secrets.language' },
  redirect: { maxHops: 3, allow: ENTRY_RULES },
  finalUrlInto: 'entryUrl',
  deriveCarry: [
    {
      into: 'rawTrackingCode',
      parts: [ENTRY_REF],
      op: { kind: 'url-query', key: 'trackingCode', rejectBlank: true },
    },
    {
      into: 'trackingCode',
      parts: ['carry.rawTrackingCode'],
      op: {
        kind: 'format',
        rules: [{ pattern: String.raw`^[^\x00-\x1f\x7f]{1,512}$`, prefix: '' }],
      },
    },
    { into: 'sysNum', parts: [ENTRY_REF], op: { kind: 'url-query', key: 'sysNum' } },
    { into: 'langNum', parts: [ENTRY_REF], op: { kind: 'url-query', key: 'langNum' } },
    {
      into: 'gatekeeperUrl',
      parts: [ENTRY_REF],
      op: {
        kind: 'url-path-map',
        key: 'langNum',
        paths: { '1': `${GATE}he/`, '2': `${GATE}en/` },
        source: ENTRY_RULES,
        url: GATE_RULES,
      },
    },
  ],
  ...HTML,
};

const GATEKEEPER: IGetStep = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  urlFromCarry: 'gatekeeperUrl',
  extractsToCarry: {},
  headers: PAGE_HEADERS,
  redirect: { maxHops: 3, allow: GATE_RULES },
  structuredCapture: { kind: 'sdk-reference', into: 'sdkUrl', url: SDK_RULES },
  ...HTML,
};

const SDK_STEP: IGetStep = {
  name: 'validate',
  urlTag: 'auth.service',
  method: 'GET',
  urlFromCarry: 'sdkUrl',
  extractsToCarry: {},
  headers: literalHeaders(CLIENT_PROFILE),
  response: 'text',
  maxTextChars: SDK_LIMIT,
  responseIntegrity: { maxBytes: SDK_LIMIT, sha256: SDK_SHA256 },
};

const HANGUP: IGetStep = {
  name: 'bootstrap',
  urlTag: 'auth.logout',
  method: 'GET',
  extractsToCarry: {},
  headers: literalHeaders({ accept: '*/*', ...CLIENT_PROFILE }),
  redirect: { maxHops: 2, allow: HANGUP_RULES },
  response: 'document',
};

const LEUMI_BOOTSTRAP_STEPS: readonly IStepConfig[] = [ENTRY, GATEKEEPER, SDK_STEP, HANGUP];

export { CLIENT_PROFILE, LEUMI_BOOTSTRAP_PATHS, LEUMI_BOOTSTRAP_STEPS };
