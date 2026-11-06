/**
 * Discount login steps — data only. The login page, the RSA key, the sealed
 * login with its one redirect hop, and the retail app; the call config in
 * `PipelineBankConfigDiscount.ts` runs them in this order.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IAnswerCase,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  DISCOUNT_DOCUMENT_HEADERS,
  DISCOUNT_LOGIN_HEADERS,
  DISCOUNT_LOGIN_POST_HEADERS,
  DISCOUNT_ORIGIN,
} from './PipelineBankConfigDiscountConstants.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

/** The login page read cap: the green client's 128 KiB limit. */
const PAGE_CAP_CHARS = 131_072;

/** The longest RSA key the login accepts, PEM or bare base64. */
const KEY_CAP_CHARS = 16_384;

/** The bank's error and step-up fields: any value in one fails the step. */
const BANK_ERROR_POINTERS = ['/Error', '/error', '/actionRequired'];

/** Where the login answer reports its status, when it does. */
const STATUS = '/Login/Status';

/** The app context the key and login calls open with, in the app's order. */
const APP_CONTEXT = {
  Application: { $literal: 'WEB' },
  Caller: { $literal: 'Internet' },
  Bank: { $literal: 'd' },
  Lang: { $literal: 'he' },
  CustType: { $literal: 'private' },
} as const;

const LOGIN_HEADERS = literalHeaders(DISCOUNT_LOGIN_HEADERS);
const LOGIN_POST_HEADERS = literalHeaders(DISCOUNT_LOGIN_POST_HEADERS);
const DOCUMENT_HEADERS = literalHeaders(DISCOUNT_DOCUMENT_HEADERS);

/** The login status: none or `SUCCESS` passes; any other value rejects the credentials. */
const STATUS_CASES: readonly IAnswerCase[] = [
  { name: 'statusAbsent', when: [{ pointer: STATUS, absent: true }] },
  { name: 'statusSuccess', when: [{ pointer: STATUS, equals: 'SUCCESS' }] },
  {
    name: 'statusRejected',
    when: [
      { pointer: STATUS, absent: true, negate: true },
      { pointer: STATUS, equals: 'SUCCESS', negate: true },
    ],
    fail: ScraperErrorTypes.InvalidPassword,
  },
];

/** Step 1 — the login page, with the routing cookies set: the app shell, no CSRF token. */
const PRIME_STEP: IStepConfig = {
  name: 'prime',
  urlTag: 'auth.prime',
  method: 'GET',
  response: 'text',
  maxTextChars: PAGE_CAP_CHARS,
  headers: LOGIN_HEADERS,
  setCookies: {
    cssName: 'config.secrets.cssName',
    language: 'config.secrets.language',
    t: 'config.secrets.t',
    caller: 'config.secrets.caller',
  },
  textCaptures: {
    appRoot: { pattern: String.raw`<app-root\b`, group: 0 },
    csrf: { pattern: 'csrfToken', group: 0, absent: true },
  },
  extractsToCarry: {},
};

/** Step 2 — the app context; the bank answers the RSA key the login is sealed under. */
const ENCRYPTION_KEY_STEP: IStepConfig = {
  name: 'encryptionKey',
  urlTag: 'auth.encryptionKey',
  body: { shape: { ...APP_CONTEXT, Source: { $literal: 1 } } },
  headers: LOGIN_POST_HEADERS,
  failIfPresent: BANK_ERROR_POINTERS,
  extractsToCarry: { rsaKey: '/GetVerificationInfo/Key' },
  extractRules: { rsaKey: { type: 'string', maxChars: KEY_CAP_CHARS } },
};

/**
 * Step 3 — the formatted id, with the user code then the password sealed
 * under the key; at most one 302/303 hop, to the login-success answer, as a
 * GET. The answer must echo the id's MD5.
 */
const LOGON_STEP: IStepConfig = {
  name: 'logon',
  urlTag: 'auth.logon',
  body: {
    shape: {
      ...APP_CONTEXT,
      PlatformType: { $literal: 'WEB' },
      Uid: { $ref: 'carry.uid' },
      ThirdIdentifierType: { $literal: 'aid' },
      ThirdIdentifier: { $literal: '' },
      Password: { $literal: '' },
    },
  },
  headers: LOGIN_POST_HEADERS,
  seal: {
    kind: 'rsa-pkcs1-v15',
    keyRef: 'carry.rsaKey',
    fields: [
      { sourceRef: 'creds.num', writeTo: '/ThirdIdentifier' },
      { sourceRef: 'creds.password', writeTo: '/Password' },
    ],
  },
  redirect: {
    maxHops: 1,
    postAsGet: true,
    allow: [
      {
        origin: DISCOUNT_ORIGIN,
        paths: ['/Lobby/gatewayAPI/loginSuccessResponse'],
        exactQuery: true,
      },
    ],
  },
  failIfPresent: BANK_ERROR_POINTERS,
  classify: { into: 'loginStatus', cases: STATUS_CASES },
  extractsToCarry: { mi6: '/Login/MI6' },
  extractRules: { mi6: { type: 'string', equalsRef: 'carry.uidMd5' } },
};

/** Step 4 — the retail app, with the login cookie set; one hop to its canonical path. */
const LANDING_STEP: IStepConfig = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  response: 'document',
  documentMarker: '<apollo-root',
  headers: DOCUMENT_HEADERS,
  setCookies: {
    mi6: 'carry.mi6',
    fte: 'config.secrets.fte',
    newRetail: 'config.secrets.newRetail',
  },
  redirect: {
    maxHops: 1,
    allow: [{ origin: DISCOUNT_ORIGIN, paths: ['/apollo/retail3/'], exactQuery: true }],
  },
  extractsToCarry: {},
};

/** The login steps, in order. */
const DISCOUNT_LOGIN_STEPS: readonly IStepConfig[] = [
  PRIME_STEP,
  ENCRYPTION_KEY_STEP,
  LOGON_STEP,
  LANDING_STEP,
];

export default DISCOUNT_LOGIN_STEPS;
export { DISCOUNT_LOGIN_STEPS };
