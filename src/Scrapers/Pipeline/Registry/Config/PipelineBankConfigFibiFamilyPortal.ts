/**
 * FIBI-family portal steps: the login-form post that hands the Transmit token
 * to the servlet, the SSO code, and the authorization header the code buys.
 * Pure data (Rule #11).
 *
 * <p>No page is read. The servlet's form fields are static and observed on the
 * wire; the bank number comes from the brand record; the client address the
 * page used to supply is not required by the login call. That removes the only
 * HTML request the login used to make.</p>
 */

import type {
  IBodyTemplate,
  IGetStep,
  IPostStep,
  IStepConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  FIBI_HTML,
  FIBI_PAGE_ACCEPT,
  FIBI_PAGE_MAX_CHARS,
  FIBI_SSO_MAX_CHARS,
  FIBI_UA,
  fibiEntryUrl,
  type IFibiBrand,
} from './PipelineBankConfigFibiFamilyConstants.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

/** The longest SSO code or authorization header read. */
const SSO_MAX_CHARS = 32768;

/** A page read as text, capped. */
const PAGE = { response: 'text', maxTextChars: FIBI_PAGE_MAX_CHARS, mediaType: FIBI_HTML } as const;

/**
 * The servlet form's static fields, observed on the real login page.
 * @param brand - FIBI-family brand.
 * @returns The fields, without the user or the token.
 */
function staticFormFields(brand: IFibiBrand): Readonly<Record<string, string>> {
  return {
    isPaymentProc: 'false',
    KODSAFA: 'HE',
    userLoginHome: 'Private',
    bankId: brand.portalId,
    showCaptcha: 'false',
    lang: 'HE',
  };
}

/**
 * One field of the login form, as a template.
 * @param value - The field's static value.
 * @returns Its template.
 */
function literalField(value: string): JsonValueTemplate {
  return { $literal: value };
}

/**
 * One field of the login form, as a `[name, template]` entry.
 * @param field - The field's name and static value.
 * @returns The entry.
 */
function formEntryOf(field: [string, string]): [string, JsonValueTemplate] {
  const [name, value] = field;
  return [name, literalField(value)];
}

/** The form values the client fills in; the rest are static. */
const FILLED: Record<string, JsonValueTemplate> = {
  passwordEnc: { $ref: 'carry.token' },
  user: { $ref: 'creds.username' },
};

/**
 * The login form's shape: the static fields, the user and the token.
 * @param brand - FIBI-family brand.
 * @returns The body template.
 */
function logonBodyOf(brand: IFibiBrand): IBodyTemplate {
  const fields = staticFormFields(brand);
  const entries = Object.entries(fields);
  const literalEntries = entries.map(formEntryOf);
  const shape = { ...Object.fromEntries(literalEntries), ...FILLED };
  return { shape };
}

/**
 * The headers the login form is posted with.
 * @param brand - FIBI-family brand.
 * @returns The headers.
 */
function logonHeadersOf(brand: IFibiBrand): Readonly<Record<string, JsonValueTemplate>> {
  const referer = fibiEntryUrl(brand);
  return literalHeaders({
    accept: FIBI_PAGE_ACCEPT,
    'user-agent': FIBI_UA,
    origin: brand.origin,
    referer,
  });
}

/**
 * The entry form, its password replaced by the Transmit token.
 *
 * <p>The servlet accepts the token without a preceding page read and answers
 * `200` with the session cookies; there is no `Location` to follow.</p>
 * @param brand - FIBI-family brand.
 * @returns The logon step.
 */
function fibiLogonStep(brand: IFibiBrand): IPostStep {
  const body = logonBodyOf(brand);
  const headers = logonHeadersOf(brand);
  const step = { name: 'logon', urlTag: 'auth.logon', extractsToCarry: {} } as const;
  return { ...step, method: 'POST', body, encoding: 'form-utf8', headers, ...PAGE };
}

const BOOTSTRAP: IPostStep = {
  name: 'bootstrap',
  urlTag: 'auth.bootstrap',
  extractsToCarry: {},
  body: { shape: { TPPName: { $literal: 'shell' } } },
  response: 'text',
  maxTextChars: FIBI_SSO_MAX_CHARS,
  textCaptures: { ssoCode: { pattern: String.raw`^[\s\S]*?code=([\s\S]+)$`, group: 1 } },
  extractRules: {
    ssoCode: {
      pattern: String.raw`^[\x21\x24-\x26\x28-\x3b\x3d\x3f-\x5b\x5d-\x7e]+$`,
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
      pattern: String.raw`^[^\x00-\x20\x7f][^\x00-\x1f\x7f]*$`,
      maxChars: SSO_MAX_CHARS,
    },
  },
  response: 'document',
  strictUtf8: false,
};

/**
 * Rows 7–8: the SSO code and its authorization header, sent from the portal.
 * @param brand - FIBI-family brand.
 * @returns The bootstrap and session-token steps.
 */
function fibiSsoSteps(brand: IFibiBrand): readonly IStepConfig[] {
  const sender = { accept: 'application/json', 'user-agent': FIBI_UA, origin: brand.origin };
  const headers = {
    ...literalHeaders(sender),
    referer: { $literal: fibiEntryUrl(brand) },
  } as const;
  const transactionId = { 'x-fibi-transaction-id': { $ref: 'uuid' } } as const;
  const sessionToken = { ...SESSION_TOKEN, headers: { ...headers, ...transactionId } };
  return [{ ...BOOTSTRAP, headers }, sessionToken];
}

export { fibiLogonStep, fibiSsoSteps };
