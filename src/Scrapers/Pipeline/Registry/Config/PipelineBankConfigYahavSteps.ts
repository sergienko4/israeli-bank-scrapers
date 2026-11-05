/**
 * Yahav native login steps (spec §10.2 rows 1–3). A cold start initializes
 * the app client and registers this device's certificate; every run then
 * takes a bearer token over that certificate, which is where a warm start
 * resumes. Secrets reach a request only through `$join` at hydration (AD-Y7).
 */

import type {
  IJoinTemplate,
  IStepConfig,
  JoinPart,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';
import {
  YAHAV_CLIENT_ID,
  YAHAV_DEVICE_NAME,
  YAHAV_NATIVE_UA,
  YAHAV_ORGANIZATION,
  YAHAV_SCOPE,
} from './PipelineBankConfigYahavConstants.js';

/** The `num-nationalID` user name every login call names. */
const USER_PARTS: readonly JoinPart[] = ['creds.num', { literal: '-' }, 'creds.nationalID'];

/** The carry slot holding the device certificate's private key. */
const CERT_KEY_REF = 'carry.certKeyPem';

/** A colon between a Basic credential's two halves. */
const COLON = { literal: ':' } as const;

/** One printable-ASCII text, as the app's credential checks demand. */
const PRINTABLE = String.raw`^[\x20-\x7e]+$`;

/**
 * Base64 text: its alphabet and padding only. A config pattern must be flat,
 * so the padding's place is the bank's to check; this keeps a header break
 * or any other text out of the value the token call echoes.
 */
const BASE64 = '^[A-Za-z0-9+/=]+$';

/**
 * A `$join` template.
 * @param join - Parts, encoding and prefix.
 * @returns The template node.
 */
function joined(join: IJoinTemplate): JsonValueTemplate {
  return { $join: join };
}

/** The device id header: base64 of the key fingerprint's hex text. */
const DEVICE_ID = joined({ parts: ['carry.deviceId'], encode: 'base64' });

const APP_HEADERS = literalHeaders({ accept: 'application/json', 'user-agent': YAHAV_NATIVE_UA });

const REGISTER_HEADERS = {
  ...literalHeaders({ accept: '*/*', 'user-agent': YAHAV_NATIVE_UA, 'cert-format': 'pem' }),
  'enable-multi-device-login': joined({ parts: [{ literal: 'false' }], encode: 'base64' }),
  'device-id': DEVICE_ID,
  'device-name': joined({ parts: [{ literal: YAHAV_DEVICE_NAME }], encode: 'base64' }),
  'create-session': { $literal: 'true' },
  authorization: joined({
    parts: [...USER_PARTS, COLON, 'creds.password'],
    encode: 'base64',
    prefix: 'Basic ',
  }),
  'client-authorization': joined({
    parts: ['carry.clientId', COLON, 'carry.clientSecret'],
    encode: 'base64',
    prefix: 'Basic ',
  }),
};

/** The CSR subject the app's registration names. */
const CSR_SUBJECT = [
  { attr: 'O', value: { $literal: YAHAV_ORGANIZATION } },
  { attr: 'DC', value: { $literal: YAHAV_DEVICE_NAME } },
  { attr: 'OU', value: { $ref: 'carry.deviceId' } },
  { attr: 'CN', value: joined({ parts: USER_PARTS }) },
] as const;

/** An issued client credential: printable ASCII, at most 256 chars. */
const CLIENT_RULE = { type: 'string', pattern: PRINTABLE, maxChars: 256 } as const;

const PRIME_STEP: IStepConfig = {
  name: 'prime',
  urlTag: 'auth.prime',
  encoding: 'form-latin1',
  generate: [{ kind: 'rsa-key', bits: 2048, spkiSha256HexInto: 'deviceId' }],
  body: { shape: { client_id: { $literal: YAHAV_CLIENT_ID }, nonce: { $ref: 'uuid' } } },
  headers: { ...APP_HEADERS, 'device-id': DEVICE_ID },
  extractsToCarry: { clientId: '/client_id', clientSecret: '/client_secret' },
  extractRules: { clientId: CLIENT_RULE, clientSecret: CLIENT_RULE },
};

const REGISTER_STEP: IStepConfig = {
  name: 'register',
  urlTag: 'auth.bind',
  encoding: 'text',
  response: 'text',
  generate: [
    { kind: 'rsa-key', bits: 2048, keyInto: 'certKeyPem' },
    { kind: 'pkcs10-csr', keyRef: CERT_KEY_REF, subject: CSR_SUBJECT, into: 'csr' },
  ],
  body: { shape: { text: { $ref: 'carry.csr' } } },
  headers: REGISTER_HEADERS,
  extractsToCarry: { certPem: '/text' },
  headerExtractsToCarry: {
    deviceStatus: { header: 'device-status' },
    mag: { header: 'mag-identifier' },
  },
  extractRules: {
    certPem: { pemCertificate: { keyRef: CERT_KEY_REF } },
    deviceStatus: { oneOf: ['activated'] },
    mag: { pattern: BASE64, maxChars: 4096 },
  },
};

const LOGON_STEP: IStepConfig = {
  name: 'logon',
  urlTag: 'auth.logon',
  encoding: 'form-latin1',
  clientCert: { key: CERT_KEY_REF, cert: 'carry.certPem' },
  body: {
    shape: {
      username: joined({ parts: USER_PARTS }),
      password: { $ref: 'creds.password' },
      client_id: { $ref: 'carry.clientId' },
      client_secret: { $ref: 'carry.clientSecret' },
      scope: { $literal: YAHAV_SCOPE },
      grant_type: { $literal: 'password' },
    },
  },
  headers: { ...APP_HEADERS, 'mag-identifier': { $ref: 'carry.mag' } },
  extractsToCarry: { token: '/access_token', tokenType: '/token_type', expiresIn: '/expires_in' },
  extractRules: {
    token: { type: 'string', pattern: PRINTABLE, maxChars: 32768 },
    tokenType: { type: 'string', transform: 'lower', oneOf: ['bearer'] },
    expiresIn: { type: 'number', pattern: String.raw`^[1-9]\d{0,14}$` },
  },
};

/** The login steps in order: two cold-only calls, then the token call. */
const YAHAV_STEPS: readonly IStepConfig[] = [PRIME_STEP, REGISTER_STEP, LOGON_STEP];

/** Where a warm start resumes: the token call, over the stored certificate. */
const YAHAV_RESUME_STEP_INDEX = YAHAV_STEPS.indexOf(LOGON_STEP);

export default YAHAV_STEPS;
export { YAHAV_RESUME_STEP_INDEX, YAHAV_STEPS };
