/**
 * Leumi website key exchange and encrypted password authentication.
 */

import type {
  IPostStep,
  ISeedCarrySource,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  LEUMI_EXCHANGE_BODY,
  LEUMI_LOGIN_BODY,
  LEUMI_PASSWORD_BODY,
} from './PipelineBankConfigLeumiBodies.js';
import { CLIENT_PROFILE } from './PipelineBankConfigLeumiBootstrap.js';
import {
  LEUMI_LOGIN_CLASSIFIER,
  LEUMI_PASSWORD_CLASSIFIER,
} from './PipelineBankConfigLeumiClassify.js';
import { LEUMI_JWT_CAPTURE, LEUMI_SITE_GUARD } from './PipelineBankConfigLeumiPortalPolicies.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

const ORIGIN = 'https://hb2.bankleumi.co.il';
const SERVICE = 'https://sa.bankleumi.co.il/api/v2/auth';
const LEUMI_TRANSMIT_PATHS = {
  'auth.encryptionKey': `${SERVICE}/key_exchange`,
  'auth.login': `${SERVICE}/login`,
  'auth.assert': `${SERVICE}/assert`,
} as const;
const HEADERS = literalHeaders({
  'content-type': 'application/json',
  accept: 'application/json',
  'x-ts-client-version': '8.1.9;[11]',
  authorization: 'TSToken 495ebdd0-0393-4a17-a925-b8b5decd4fa6; tid=webapp_token',
  origin: ORIGIN,
  referer: `${ORIGIN}/`,
  ...CLIENT_PROFILE,
});
const QUERY = { aid: { $literal: 'webapp' }, locale: { $literal: 'he-IL' } } as const;
const SEALED = {
  kind: 'ecdh-aes-cbc',
  mode: 'sealed',
  keyRef: 'carry.envelopeKey',
  sessionRef: 'carry.envelopeSession',
} as const;
const SESSION_RULE = {
  pattern: String.raw`^[^\x00-\x1f\x7f]+$`,
  maxChars: 512,
};
const COMMON = {
  headers: HEADERS,
  mediaType: 'application/json',
  responseIntegrity: { maxBytes: 262144 },
} as const;
const LEUMI_TRANSMIT_SEEDS: readonly ISeedCarrySource[] = [
  {
    field: 'flowId',
    bootstrap: { kind: 'random-hex', bytes: 32, isUpperCase: true },
    alwaysBootstrap: true,
  },
];

const EXCHANGE: IPostStep = {
  ...COMMON,
  name: 'encryptionKey',
  urlTag: 'auth.encryptionKey',
  queryTemplate: QUERY,
  extractsToCarry: {},
  generate: [
    { kind: 'ecdh-key', curve: 'secp256k1', publicInto: 'ecdhPublic', privateInto: 'ecdhPrivate' },
  ],
  body: LEUMI_EXCHANGE_BODY,
  codec: {
    kind: 'ecdh-aes-cbc',
    mode: 'exchange',
    privateRef: 'carry.ecdhPrivate',
    echoRef: 'carry.ecdhPublic',
    keyInto: 'envelopeKey',
    sessionInto: 'envelopeSession',
  },
};
const LOGIN: IPostStep = {
  ...COMMON,
  name: 'login',
  urlTag: 'auth.login',
  queryTemplate: QUERY,
  body: LEUMI_LOGIN_BODY,
  codec: SEALED,
  classify: LEUMI_LOGIN_CLASSIFIER,
  extractsToCarry: {
    sid: '/headers/?type=session_id/session_id',
    did: '/headers/?type=device_id/device_id',
  },
  extractRules: { sid: SESSION_RULE, did: SESSION_RULE },
};
const PASSWORD: IPostStep = {
  ...COMMON,
  name: 'assertPassword',
  urlTag: 'auth.assert',
  queryTemplate: {
    aid: { $literal: 'webapp' },
    did: { $ref: 'carry.did' },
    sid: { $ref: 'carry.sid' },
    locale: { $literal: 'he-IL' },
  },
  body: LEUMI_PASSWORD_BODY,
  codec: SEALED,
  classify: LEUMI_PASSWORD_CLASSIFIER,
  failIfPresent: ['/data/assertion_error_code'],
  extractsToCarry: { token: '/data/token' },
  structuredCapture: LEUMI_JWT_CAPTURE,
  deriveCarry: LEUMI_SITE_GUARD,
};
const LEUMI_TRANSMIT_STEPS: readonly IPostStep[] = [EXCHANGE, LOGIN, PASSWORD];

export { LEUMI_TRANSMIT_PATHS, LEUMI_TRANSMIT_SEEDS, LEUMI_TRANSMIT_STEPS };
