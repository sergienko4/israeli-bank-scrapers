/**
 * N8 — step reading, encoding and header carry require a node-backed
 * transport; bank-wide redirect, status and text defaults require native
 * fetch. `cookieDomains` needs a node-backed session jar. Header and cookie
 * names must be valid HTTP tokens.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/** The bank's headless block when it has one. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['headless'], false>;

const HOST = 'https://native.example';
const PLAIN: HeadlessBlock = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {} };
const NATIVE: HeadlessBlock = { ...PLAIN, nativeFetch: true };
const JAR: HeadlessBlock = { ...NATIVE, sessionCookies: true };
const DYNAMIC_TLS: HeadlessBlock = {
  ...PLAIN,
  clientCert: { mode: 'dynamic', origin: HOST },
};
const DYNAMIC_JAR: HeadlessBlock = {
  ...DYNAMIC_TLS,
  sessionCookies: true,
  cookieDomains: ['native.example'],
};

const CALL: IStepConfig = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  extractsToCarry: {},
};

const PAGE: IStepConfig = { ...CALL, response: 'document' };
const MARKED: IStepConfig = { ...CALL, response: 'document', documentMarker: 'welcome' };
const MARKED_JSON: IStepConfig = { ...CALL, documentMarker: 'welcome' };
const REJECTING: IStepConfig = { ...CALL, redirect: 'reject' };
const FORM: IStepConfig = {
  name: 'login',
  urlTag: 'auth.login',
  encoding: 'form',
  body: { shape: { a: { $literal: 'x' } } },
  extractsToCarry: {},
};
const TEXT: IStepConfig = {
  ...FORM,
  encoding: 'text',
  body: { shape: { text: { $literal: 'payload' } } },
};

/**
 * The call step setting one client cookie under the given name.
 * @param name - Cookie name.
 * @returns Step config.
 */
function setting(name: string): IStepConfig {
  return { ...CALL, setCookies: { [name]: 'carry.g3' } };
}

/**
 * The call step carrying one response header under the given name.
 * @param header - Header name.
 * @returns Step config.
 */
function carrying(header: string): IStepConfig {
  return { ...CALL, headerExtractsToCarry: { slot: { header } } };
}

/**
 * Rule input running the given steps beside the given headless block.
 * @param steps - Login steps.
 * @param headless - Bank headless block, or false when it has none.
 * @returns Rule input.
 */
function runOf(
  steps: readonly IStepConfig[],
  headless: IApiDirectRuleInput['headless'],
): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps }, headless };
}

/**
 * Rule input whose only resume step is the given one.
 * @param step - Resume step.
 * @returns Rule input with a plain headless block.
 */
function resumeOf(step: IStepConfig): IApiDirectRuleInput {
  const persistentAuth = {
    provider: 'syn-provider',
    clientInstanceIdField: 'clientInstanceId',
    deviceIdField: 'deviceId',
    accountField: 'account',
    freshnessMarginSeconds: 60,
    resumeSteps: [step],
  };
  return {
    call: { flow: 'sms-otp', envelope: {}, steps: [CALL], persistentAuth },
    headless: PLAIN,
  };
}

const OFF = 'not allowed without headless.nativeFetch';
const HEADER_MSG = 'headerExtractsToCarry.header: must be an HTTP header name';
const NO_DOMAIN_JAR = 'steps.setCookies: not allowed without headless.cookieDomains';
const COOKIE_NAME_MSG = 'steps.setCookies: each name must be an HTTP token';
const DOMAIN_JAR: HeadlessBlock = { ...JAR, cookieDomains: ['native.example'] };
const SETTING_G3 = setting('G3CmE');

/** A config, the headless block beside it, and the text it fails with. */
interface IBrokenCase {
  readonly label: string;
  readonly input: IApiDirectRuleInput;
  readonly message: string;
}

const BROKEN: readonly IBrokenCase[] = [
  {
    label: 'document step, no headless',
    input: runOf([PAGE], false),
    message: `steps.response: ${OFF}`,
  },
  { label: 'document step, plain', input: runOf([PAGE], PLAIN), message: `steps.response: ${OFF}` },
  {
    label: 'marker off a document step',
    input: runOf([MARKED_JSON], NATIVE),
    message: 'steps.documentMarker: only on a document step',
  },
  {
    label: 'marker off a document resume step',
    input: resumeOf(MARKED_JSON),
    message: 'steps.documentMarker: only on a document step',
  },
  {
    label: 'reject step, plain',
    input: runOf([REJECTING], PLAIN),
    message: `steps.redirect: ${OFF}`,
  },
  { label: 'reject resume step', input: resumeOf(REJECTING), message: `steps.redirect: ${OFF}` },
  { label: 'form step, plain', input: runOf([FORM], PLAIN), message: `steps.encoding: ${OFF}` },
  {
    label: 'header carry, native off',
    input: runOf([carrying('x-id')], { ...PLAIN, nativeFetch: false }),
    message: `steps.headerExtractsToCarry: ${OFF}`,
  },
  {
    label: 'cookie domains, plain jar',
    input: runOf([CALL], { ...PLAIN, sessionCookies: true, cookieDomains: ['native.example'] }),
    message: `headless.cookieDomains: ${OFF}`,
  },
  {
    label: 'bank redirect policy, plain',
    input: runOf([CALL], { ...PLAIN, redirectPolicy: 'reject' }),
    message: `headless.redirectPolicy: ${OFF}`,
  },
  {
    label: 'bank status policy, plain',
    input: runOf([CALL], { ...PLAIN, statusPolicy: { 204: 'empty' } }),
    message: `headless.statusPolicy: ${OFF}`,
  },
  {
    label: 'bank text omission, plain',
    input: runOf([CALL], { ...PLAIN, omitBankText: true }),
    message: `headless.omitBankText: ${OFF}`,
  },
  {
    label: 'bank text omission, dynamic mTLS',
    input: runOf([CALL], { ...DYNAMIC_TLS, omitBankText: true }),
    message: `headless.omitBankText: ${OFF}`,
  },
  {
    label: 'cookie domains, no jar',
    input: runOf([CALL], { ...NATIVE, cookieDomains: ['native.example'] }),
    message: 'headless.cookieDomains: not allowed without headless.sessionCookies',
  },
  { label: 'empty header name', input: runOf([carrying('')], NATIVE), message: HEADER_MSG },
  { label: 'header name, space', input: runOf([carrying('x id')], NATIVE), message: HEADER_MSG },
  { label: 'header name, colon', input: runOf([carrying('x:id')], NATIVE), message: HEADER_MSG },
  { label: 'header name, newline', input: runOf([carrying('x\nid')], NATIVE), message: HEADER_MSG },
  {
    label: 'set cookie, no headless',
    input: runOf([setting('G3CmE')], false),
    message: NO_DOMAIN_JAR,
  },
  { label: 'set cookie, host jar', input: runOf([setting('G3CmE')], JAR), message: NO_DOMAIN_JAR },
  { label: 'set cookie on resume', input: resumeOf(SETTING_G3), message: NO_DOMAIN_JAR },
  { label: 'empty cookie name', input: runOf([setting('')], DOMAIN_JAR), message: COOKIE_NAME_MSG },
  {
    label: 'cookie name, separator',
    input: runOf([setting('a;b')], DOMAIN_JAR),
    message: COOKIE_NAME_MSG,
  },
  {
    label: 'cookie name, equals',
    input: runOf([setting('a=b')], DOMAIN_JAR),
    message: COOKIE_NAME_MSG,
  },
  {
    label: 'cookie name, space',
    input: runOf([setting('a b')], DOMAIN_JAR),
    message: COOKIE_NAME_MSG,
  },
];

/** A config the rules accept. */
interface ISoundCase {
  readonly label: string;
  readonly input: IApiDirectRuleInput;
}

const EVERY_FIELD: HeadlessBlock = {
  ...JAR,
  cookieDomains: ['native.example'],
  redirectPolicy: 'reject',
  statusPolicy: { 204: 'empty' },
  omitBankText: true,
};

const SOUND: readonly ISoundCase[] = [
  { label: 'plain step, no headless', input: runOf([CALL], false) },
  { label: 'plain step, native off', input: runOf([CALL], { ...PLAIN, nativeFetch: false }) },
  {
    label: 'every field on native fetch',
    input: runOf(
      [PAGE, MARKED, REJECTING, FORM, carrying("X-Trace_ID.v2!#$%&'*+^`|~"), setting('G3CmE')],
      EVERY_FIELD,
    ),
  },
  { label: 'text POST on dynamic mTLS', input: runOf([TEXT], DYNAMIC_TLS) },
  {
    label: 'Latin-1 form on dynamic mTLS',
    input: runOf([{ ...FORM, encoding: 'form-latin1' }], DYNAMIC_TLS),
  },
  {
    label: 'text and document responses on dynamic mTLS',
    input: runOf([{ ...CALL, response: 'text' }, PAGE, MARKED], DYNAMIC_TLS),
  },
  {
    label: 'step redirect on dynamic mTLS',
    input: runOf([REJECTING], DYNAMIC_TLS),
  },
  {
    label: 'header extracts and domain cookies on dynamic mTLS',
    input: runOf([carrying('x-id'), setting('G3CmE')], DYNAMIC_JAR),
  },
];

describe('validateApiDirectConfig — native-fetch fields', () => {
  it.each(BROKEN)('$label → fails with the rule text', ({ input, message }) => {
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: message,
    });
  });

  it.each(SOUND)('$label → passes', ({ input }) => {
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
