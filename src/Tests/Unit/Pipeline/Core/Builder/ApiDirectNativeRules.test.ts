/**
 * Node-backed readers, media types, encoding, headers and domain
 * cookies and strict UTF-8 steps; native-fetch-only redirect, status,
 * failure-text and bank-wide media-type and UTF-8 defaults. Domain cookies
 * need a jar; header and cookie names must be tokens. The media-type and
 * strict UTF-8 override rules validate those values.
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
const PROFILE: HeadlessBlock = { ...PLAIN, tlsProfile: 'android-11-okhttp' };
const REGISTERED: HeadlessBlock = { ...PLAIN, requiresClientCert: true };

const CALL: IStepConfig = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  extractsToCarry: {},
};

const PAGE: IStepConfig = { ...CALL, response: 'document' };
const MARKED: IStepConfig = { ...CALL, response: 'document', documentMarker: 'welcome' };
const MARKED_JSON: IStepConfig = { ...CALL, documentMarker: 'welcome' };
const TYPED: IStepConfig = { ...CALL, mediaType: 'text/html' };
const STRICT: IStepConfig = { ...CALL, strictUtf8: true };
const LAX: IStepConfig = { ...CALL, strictUtf8: false };
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
    kind: 'bound-device' as const,
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
const NODE_OFF = 'not allowed without nativeFetch or node:https';
const HEADER_MSG = 'headerExtractsToCarry.header: must be an HTTP header name';
const NO_DOMAIN_JAR = 'steps.setCookies: not allowed without headless.cookieDomains';
const COOKIE_NAME_MSG = 'steps.setCookies: each name must be an HTTP token';
const DOMAIN_JAR: HeadlessBlock = { ...JAR, cookieDomains: ['native.example'] };
const SETTING_G3 = setting('G3CmE');
const MEDIA_MSG = 'mediaType: must be a lower-case type/subtype';
const MEDIA_KIND_MSG = 'headless.mediaTypes: keys must be response kinds';
const LAX_MSG = 'steps.strictUtf8: false only overrides headless.strictUtf8';

/**
 * Rule input whose one native step names the given media type.
 * @param mediaType - The step's media type.
 * @returns Rule input on native fetch.
 */
function typedAs(mediaType: string): IApiDirectRuleInput {
  return runOf([{ ...CALL, mediaType }], NATIVE);
}

/**
 * Rule input whose native bank names the given media type defaults.
 * @param mediaTypes - The bank's defaults per response kind.
 * @returns Rule input on native fetch.
 */
function bankTyped(mediaTypes: Readonly<Record<string, string>>): IApiDirectRuleInput {
  return runOf([CALL], { ...NATIVE, mediaTypes });
}

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
    message: `steps.response: ${NODE_OFF}`,
  },
  {
    label: 'document step, plain',
    input: runOf([PAGE], PLAIN),
    message: `steps.response: ${NODE_OFF}`,
  },
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
  {
    label: 'reject step, client cert',
    input: runOf([REJECTING], DYNAMIC_TLS),
    message: `steps.redirect: ${OFF}`,
  },
  {
    label: 'form step, plain',
    input: runOf([FORM], PLAIN),
    message: `steps.encoding: ${NODE_OFF}`,
  },
  {
    label: 'header carry, native off',
    input: runOf([carrying('x-id')], { ...PLAIN, nativeFetch: false }),
    message: `steps.headerExtractsToCarry: ${NODE_OFF}`,
  },
  {
    label: 'header carry, registered cert off',
    input: runOf([carrying('x-id')], { ...PLAIN, requiresClientCert: false }),
    message: `steps.headerExtractsToCarry: ${NODE_OFF}`,
  },
  {
    label: 'cookie domains, plain jar',
    input: runOf([CALL], { ...PLAIN, sessionCookies: true, cookieDomains: ['native.example'] }),
    message: `headless.cookieDomains: ${NODE_OFF}`,
  },
  {
    label: 'bank redirect policy, plain',
    input: runOf([CALL], { ...PLAIN, redirectPolicy: 'reject' }),
    message: `headless.redirectPolicy: ${OFF}`,
  },
  {
    label: 'bank redirect policy, client cert',
    input: runOf([CALL], { ...DYNAMIC_TLS, redirectPolicy: 'reject' }),
    message: `headless.redirectPolicy: ${OFF}`,
  },
  {
    label: 'connect retry opt-out, plain',
    input: runOf([CALL], { ...PLAIN, isConnectRetryDisabled: true }),
    message: `headless.isConnectRetryDisabled: ${OFF}`,
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
    label: 'bank status policy, TLS profile',
    input: runOf([CALL], { ...PROFILE, statusPolicy: { 204: 'empty' } }),
    message: `headless.statusPolicy: ${OFF}`,
  },
  {
    label: 'media type step, plain',
    input: runOf([TYPED], PLAIN),
    message: `steps.mediaType: ${NODE_OFF}`,
  },
  {
    label: 'bank media types, TLS profile',
    input: runOf([CALL], { ...PROFILE, mediaTypes: { json: 'application/json' } }),
    message: `headless.mediaTypes: ${OFF}`,
  },
  { label: 'media type, upper case', input: typedAs('Text/HTML'), message: MEDIA_MSG },
  { label: 'media type, parameter', input: typedAs('text/html;charset=utf-8'), message: MEDIA_MSG },
  { label: 'media type, no subtype', input: typedAs('text'), message: MEDIA_MSG },
  { label: 'media type, empty', input: typedAs(''), message: MEDIA_MSG },
  { label: 'bank media type, bad value', input: bankTyped({ json: 'json' }), message: MEDIA_MSG },
  {
    label: 'bank media type, unknown kind',
    input: bankTyped({ html: 'text/html' }),
    message: MEDIA_KIND_MSG,
  },
  {
    label: 'strict UTF-8 step, plain',
    input: runOf([STRICT], PLAIN),
    message: `steps.strictUtf8: ${NODE_OFF}`,
  },
  {
    label: 'bank strict UTF-8, TLS profile',
    input: runOf([CALL], { ...PROFILE, strictUtf8: true }),
    message: `headless.strictUtf8: ${OFF}`,
  },
  { label: 'lax step, bank not strict', input: runOf([LAX], NATIVE), message: LAX_MSG },
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
  mediaTypes: { json: 'application/json', document: 'text/html' },
  strictUtf8: true,
  isConnectRetryDisabled: true,
};

/** The steps whose fields node:https reads and writes as native fetch does. */
const NODE_STEPS = [PAGE, MARKED, TYPED, STRICT, FORM, carrying('x-id'), setting('G3CmE')];

/**
 * A node:https block keeping a domain jar.
 * @param transport - The block selecting node:https.
 * @returns The block with a session jar on the test domain.
 */
function withDomainJar(transport: HeadlessBlock): HeadlessBlock {
  return { ...transport, sessionCookies: true, cookieDomains: ['native.example'] };
}

const PROFILE_JAR = withDomainJar(PROFILE);
const REGISTERED_JAR = withDomainJar(REGISTERED);

const SOUND: readonly ISoundCase[] = [
  { label: 'plain step, no headless', input: runOf([CALL], false) },
  { label: 'plain step, native off', input: runOf([CALL], { ...PLAIN, nativeFetch: false }) },
  {
    label: 'every field on native fetch',
    input: runOf(
      [
        PAGE,
        MARKED,
        TYPED,
        STRICT,
        LAX,
        REJECTING,
        FORM,
        carrying("X-Trace_ID.v2!#$%&'*+^`|~"),
        setting('G3CmE'),
      ],
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
    label: 'header extracts and domain cookies on dynamic mTLS',
    input: runOf([carrying('x-id'), setting('G3CmE')], DYNAMIC_JAR),
  },
  { label: 'node fields, dynamic client cert', input: runOf(NODE_STEPS, DYNAMIC_JAR) },
  { label: 'node fields, TLS profile', input: runOf(NODE_STEPS, PROFILE_JAR) },
  { label: 'node fields, registered cert', input: runOf(NODE_STEPS, REGISTERED_JAR) },
  { label: 'media type with a token subtype', input: typedAs('application/vnd.bank+json') },
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

  it.each([
    ['missing ref', { optional: true }],
    ['empty carry slot', { ref: 'carry.', optional: true }],
    ['unknown ref', { ref: 'unknown.slot', optional: true }],
    ['non-string ref', { ref: 42, optional: true }],
    ['false optional flag', { ref: 'carry.g3', optional: false }],
    ['extra field', { ref: 'carry.g3', optional: true, ignored: true }],
  ])('refuses an optional cookie with %s before IO', (_label, entry) => {
    const setCookies = { G3CmE: entry } as IStepConfig['setCookies'];
    const input = runOf([{ ...CALL, setCookies }], DOMAIN_JAR);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.setCookies: each source must be a valid ref or optional ref',
    });
  });

  it('accepts a valid optional cookie source', () => {
    const setCookies = { G3CmE: { ref: 'carry.g3', optional: true } } as const;
    const input = runOf([{ ...CALL, setCookies }], DOMAIN_JAR);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it.each(['carry.', 'unknown.slot'])('rejects invalid required cookie ref %s', ref => {
    const setCookies = { G3CmE: ref } as IStepConfig['setCookies'];
    const input = runOf([{ ...CALL, setCookies }], DOMAIN_JAR);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.setCookies: each source must be a valid ref or optional ref',
    });
  });
});
