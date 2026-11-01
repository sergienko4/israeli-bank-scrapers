/**
 * FIBI-family portal steps (spec §11.2 rows 1 and 5–8): the entry page that
 * states the bank number and client address and carries the login form; the
 * form post that hands off to the portal; the landing; the SSO code; and the
 * authorization header the code buys. Pure data (Rule #11).
 */

import type {
  IGetStep,
  IPostStep,
  IStepConfig,
  ITextCapture,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  FIBI_HTML,
  FIBI_PAGE_ACCEPT,
  FIBI_PAGE_MAX_CHARS,
  FIBI_SSO_MAX_CHARS,
  FIBI_UA,
  fibiEntryUrl,
  fibiPortalRule,
  fibiServletUrl,
  type IFibiBrand,
} from './PipelineBankConfigFibiFamilyConstants.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

/** The longest SSO code or authorization header read. */
const SSO_MAX_CHARS = 32768;

/** A page read as text, capped. */
const PAGE = { response: 'text', maxTextChars: FIBI_PAGE_MAX_CHARS, mediaType: FIBI_HTML } as const;

/**
 * A script assignment `name = "value"` (either quote); a page with two is refused.
 * @param name - The assigned variable.
 * @returns The capture.
 */
function assignment(name: string): ITextCapture {
  return { pattern: String.raw`\b${name}\s*=\s*(["'])([^"']*)\1`, group: 2 };
}

const PRIME: IGetStep = {
  name: 'prime',
  urlTag: 'auth.prime',
  method: 'GET',
  extractsToCarry: {},
  headers: literalHeaders({ accept: FIBI_HTML, 'user-agent': FIBI_UA }),
  ...PAGE,
  generate: [
    { kind: 'ecdh-key', curve: 'secp256k1', publicInto: 'ecdhPublic', privateInto: 'ecdhPrivate' },
  ],
  textCaptures: { bankNum: assignment('bankNum'), client_ip: assignment('client_ip') },
};

/** The entry form, its password replaced by the Transmit token. */
const LOGON: IPostStep = {
  name: 'logon',
  urlTag: 'auth.logon',
  extractsToCarry: {},
  body: {
    shape: {
      $merge: {
        base: 'carry.loginForm',
        set: { passwordEnc: { $ref: 'carry.token' }, user: { $ref: 'creds.username' } },
      },
    },
  },
  encoding: 'form-utf8',
  ...PAGE,
};

const LANDING: IGetStep = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  extractsToCarry: {},
  urlFromCarry: 'handoffUrl',
  finalUrlInto: 'landingUrl',
  headers: literalHeaders({ accept: FIBI_PAGE_ACCEPT, 'user-agent': FIBI_UA }),
  response: 'document',
  mediaType: FIBI_HTML,
};

const BOOTSTRAP: IPostStep = {
  name: 'bootstrap',
  urlTag: 'auth.bootstrap',
  extractsToCarry: {},
  body: { shape: { TPPName: { $literal: 'shell' } } },
  response: 'text',
  maxTextChars: FIBI_SSO_MAX_CHARS,
  textCaptures: { ssoCode: { pattern: '^[\\s\\S]*?code=([\\s\\S]+)$', group: 1 } },
  extractRules: {
    ssoCode: {
      pattern: '^[\\x21\\x24-\\x26\\x28-\\x3b\\x3d\\x3f-\\x5b\\x5d-\\x7e]+$',
      maxChars: SSO_MAX_CHARS,
    },
  },
};

/** The answer's body is not read, so it need not be strict UTF-8. */
const SESSION_TOKEN: IGetStep = {
  name: 'sessionToken',
  urlTag: 'identity.sessionToken',
  method: 'GET',
  extractsToCarry: {},
  rawQuery: { prefix: 'code=', parts: ['carry.ssoCode'] },
  headerExtractsToCarry: { authorization: { header: 'authorization' } },
  extractRules: {
    authorization: {
      pattern: '^[^\\x00-\\x20\\x7f][^\\x00-\\x1f\\x7f]*$',
      maxChars: SSO_MAX_CHARS,
    },
  },
  response: 'document',
  strictUtf8: false,
};

/**
 * Row 1: the entry page, checked to be the brand's own, and its login form.
 * @param brand - FIBI-family brand.
 * @returns The prime step.
 */
function fibiPrimeStep(brand: IFibiBrand): IGetStep {
  const action = fibiServletUrl(brand);
  const required = ['user', 'passwordEnc', 'bankId'];
  const form = {
    form: 'loginServlet',
    into: 'loginForm',
    action,
    required,
    forbidden: ['password'],
  };
  const clientIp = { pattern: '^[0-9A-Fa-f.:]{2,45}$', maxChars: 45 };
  const extractRules = { bankNum: { oneOf: [brand.bankNum] }, client_ip: clientIp };
  return { ...PRIME, extractRules, formCapture: { ...form, minFields: 3, maxFields: 32 } };
}

/**
 * Rows 5–6: the form post, whose page names the portal hand-off, then the
 * hand-off itself; both kept to the portal.
 * @param brand - FIBI-family brand.
 * @returns The logon and landing steps.
 */
function fibiHandoffSteps(brand: IFibiBrand): readonly IStepConfig[] {
  const portal = [fibiPortalRule(brand)];
  const referer = fibiEntryUrl(brand);
  const sender = { 'user-agent': FIBI_UA, origin: brand.origin, referer };
  const headers = literalHeaders({ accept: FIBI_PAGE_ACCEPT, ...sender });
  const locationCapture = { into: 'handoffUrl', userAgent: FIBI_UA, url: portal };
  const landing = { ...LANDING, redirect: { maxHops: 3, allow: portal } };
  return [{ ...LOGON, headers, locationCapture }, landing];
}

/**
 * Rows 7–8: the SSO code and its authorization header, sent from the landing.
 * @param brand - FIBI-family brand.
 * @returns The bootstrap and session-token steps.
 */
function fibiSsoSteps(brand: IFibiBrand): readonly IStepConfig[] {
  const sender = { accept: 'application/json', 'user-agent': FIBI_UA, origin: brand.origin };
  const headers = { ...literalHeaders(sender), referer: { $ref: 'carry.landingUrl' } } as const;
  const transactionId = { 'x-fibi-transaction-id': { $ref: 'uuid' } } as const;
  const sessionToken = { ...SESSION_TOKEN, headers: { ...headers, ...transactionId } };
  return [{ ...BOOTSTRAP, headers }, sessionToken];
}

export { fibiHandoffSteps, fibiPrimeStep, fibiSsoSteps };
