/**
 * Telebank family login steps — data built from a brand. The login page,
 * the RSA key, the sealed login with its one redirect hop, and the retail
 * app; the call config in `PipelineBankConfigTelebankFamily.ts` runs them in
 * this order.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IAnswerCase,
  IBodyTemplate,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';
import type { ITelebankBrand } from './PipelineBankConfigTelebankFamilyConstants.js';
import {
  TELEBANK_ORIGIN,
  telebankDocumentHeaders,
  telebankLoginHeaders,
  telebankLoginPostHeaders,
} from './PipelineBankConfigTelebankFamilyConstants.js';

/** The login page read cap: the green client's 128 KiB limit. */
const PAGE_CAP_CHARS = 131_072;

/** The longest RSA key the login accepts, PEM or bare base64. */
const KEY_CAP_CHARS = 16_384;

/** The bank's error and step-up fields: any value in one fails the step. */
const BANK_ERROR_POINTERS = ['/Error', '/error', '/actionRequired'];

/** Where the login answer reports its status, when it does. */
const STATUS = '/Login/Status';

/**
 * The app context the key and login calls open with, in the app's order.
 * @param brand - Telebank brand.
 * @returns The context's body fields.
 */
function appContext(brand: ITelebankBrand): Readonly<Record<string, { $literal: string }>> {
  return {
    Application: { $literal: 'WEB' },
    Caller: { $literal: 'Internet' },
    Bank: { $literal: brand.bankCode },
    Lang: { $literal: 'he' },
    CustType: { $literal: 'private' },
  };
}

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

/**
 * The login-call headers, templated.
 * @param brand - Telebank brand.
 * @returns Step header templates.
 */
function loginHeaders(brand: ITelebankBrand): IStepConfig['headers'] {
  const headers = telebankLoginHeaders(brand);
  return literalHeaders(headers);
}

/**
 * The login-POST headers, templated.
 * @param brand - Telebank brand.
 * @returns Step header templates.
 */
function loginPostHeaders(brand: ITelebankBrand): IStepConfig['headers'] {
  const headers = telebankLoginPostHeaders(brand);
  return literalHeaders(headers);
}

/**
 * The retail-app page-load headers, templated.
 * @param brand - Telebank brand.
 * @returns Step header templates.
 */
function documentHeaders(brand: ITelebankBrand): IStepConfig['headers'] {
  const headers = telebankDocumentHeaders(brand);
  return literalHeaders(headers);
}

/** Step 1 — the login page, with the routing cookies set: the app shell, no CSRF token. */
const PRIME_STEP = {
  name: 'prime',
  urlTag: 'auth.prime',
  method: 'GET',
  response: 'text',
  maxTextChars: PAGE_CAP_CHARS,
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
} as const;

/** Step 2 — the app context; the bank answers the RSA key the login is sealed under. */
const ENCRYPTION_KEY_STEP = {
  name: 'encryptionKey',
  urlTag: 'auth.encryptionKey',
  failIfPresent: BANK_ERROR_POINTERS,
  extractsToCarry: { rsaKey: '/GetVerificationInfo/Key' },
  extractRules: { rsaKey: { type: 'string', maxChars: KEY_CAP_CHARS } },
} as const;

/**
 * Step 3 — the formatted id, with the user code then the password sealed
 * under the key; at most one 302/303 hop, to the login-success answer, as a
 * GET. The answer must echo the id's MD5.
 */
const LOGON_STEP = {
  name: 'logon',
  urlTag: 'auth.logon',
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
        origin: TELEBANK_ORIGIN,
        paths: ['/Lobby/gatewayAPI/loginSuccessResponse'],
        exactQuery: true,
      },
    ],
  },
  failIfPresent: BANK_ERROR_POINTERS,
  classify: { into: 'loginStatus', cases: STATUS_CASES },
  extractsToCarry: { mi6: '/Login/MI6' },
  extractRules: { mi6: { type: 'string', equalsRef: 'carry.uidMd5' } },
} as const;

/** Step 4 — the retail app, with the login cookie set; one hop to its canonical path. */
const LANDING_STEP = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  response: 'document',
  documentMarker: '<apollo-root',
  setCookies: {
    mi6: 'carry.mi6',
    fte: 'config.secrets.fte',
    newRetail: 'config.secrets.newRetail',
  },
  redirect: {
    maxHops: 1,
    allow: [{ origin: TELEBANK_ORIGIN, paths: ['/apollo/retail3/'], exactQuery: true }],
  },
  extractsToCarry: {},
} as const;

/**
 * The login body: the app context, then the formatted id.
 * @param brand - Telebank brand.
 * @returns The body shape, in the app's order.
 */
function logonBody(brand: ITelebankBrand): IBodyTemplate {
  const context = appContext(brand);
  const id = {
    Uid: { $ref: 'carry.uid' },
    ThirdIdentifierType: { $literal: 'aid' },
    ThirdIdentifier: { $literal: '' },
    Password: { $literal: '' },
  } as const;
  return { shape: { ...context, PlatformType: { $literal: 'WEB' }, ...id } };
}

/**
 * The brand's key call: its app context, from its login page.
 * @param brand - Telebank brand.
 * @returns The step.
 */
function encryptionKeyStep(brand: ITelebankBrand): IStepConfig {
  const context = appContext(brand);
  const headers = loginPostHeaders(brand);
  return {
    ...ENCRYPTION_KEY_STEP,
    body: { shape: { ...context, Source: { $literal: 1 } } },
    headers,
  };
}

/**
 * The brand's login steps, in order: each fixed step gets the brand's
 * headers, and the key and login calls its app context.
 * @param brand - Telebank brand.
 * @returns The four steps.
 */
function telebankLoginSteps(brand: ITelebankBrand): readonly IStepConfig[] {
  const prime = { ...PRIME_STEP, headers: loginHeaders(brand) };
  const logon = { ...LOGON_STEP, body: logonBody(brand), headers: loginPostHeaders(brand) };
  const landing = { ...LANDING_STEP, headers: documentHeaders(brand) };
  return [prime, encryptionKeyStep(brand), logon, landing];
}

export default telebankLoginSteps;
export { telebankLoginSteps };
