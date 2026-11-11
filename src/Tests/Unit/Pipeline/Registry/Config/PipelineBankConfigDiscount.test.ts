/**
 * Discount api-direct login config. The build-time
 * validator accepts it with its headless block; each step hydrates to the
 * request the protocol trace pinned — the login page with the routing
 * cookies, the RSA key, the sealed login with its one redirect hop, and the
 * retail app — and each answer check maps the bank's verdict to the
 * library's error types.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test rule
 * (Pipeline tests don't statically import from Registry/Config).
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { applyDerivedCarry } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/FlowInitCarry.derived.js';
import { checkRequiredCreds } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RequiredCreds.js';
import { classifyAnswer } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.classify.js';
import { guardBankError } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.failIfPresent.js';
import { captureText } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.textCapture.js';
import { stepNamed } from './BeinleumiConfigTestHelpers.js';
import {
  CARRY,
  CREDS,
  hydratedHeaders,
  hydrateFixed,
  loadModule,
  LOGIN_PAGE,
  ORIGIN,
  resolvedCookies,
  ruled,
  UA,
  UID,
  UID_MD5,
  verdictOf,
} from './DiscountConfigTestHelpers.js';

const GENERIC = ScraperErrorTypes.Generic;
const INVALID_PASSWORD = ScraperErrorTypes.InvalidPassword;

/** The JSON headers a login call sends from the login page. */
const LOGIN_HEADERS = { accept: 'application/json', referer: LOGIN_PAGE, accountnumber: '' };

/** The app context the key and login calls open with. */
const APP_CONTEXT = {
  Application: 'WEB',
  Caller: 'Internet',
  Bank: 'd',
  Lang: 'he',
  CustType: 'private',
};

describe('Discount api-direct login config — wiring', () => {
  it('passes the build-time validator with its headless block', async () => {
    const { call, headless } = await loadModule();
    const result = validateApiDirectConfig({ call, transport: headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('primes the login page, takes the RSA key, logs in, then opens the retail app', async () => {
    const { call } = await loadModule();
    const named = call.steps.map(step => [step.name, step.urlTag, step.method ?? 'POST']);
    expect(named).toEqual([
      ['prime', 'auth.prime', 'GET'],
      ['encryptionKey', 'auth.encryptionKey', 'POST'],
      ['logon', 'auth.logon', 'POST'],
      ['landing', 'auth.landing', 'GET'],
    ]);
  });

  it('names each call on the telebank origin', async () => {
    const { headless } = await loadModule();
    expect(headless.paths).toEqual({
      'auth.prime': LOGIN_PAGE,
      'auth.encryptionKey': `${ORIGIN}/Lobby/gatewayAPI/verification/getInfo`,
      'auth.logon': `${ORIGIN}/Lobby/gatewayAPI/login`,
      'auth.landing': `${ORIGIN}/apollo/retail3`,
    });
    expect(headless).toMatchObject({ identityBase: `${ORIGIN}/`, graphql: `${ORIGIN}/` });
  });

  it('runs over native fetch in one telebank cookie jar, refusing undeclared redirects', async () => {
    const { headless } = await loadModule();
    expect(headless).toMatchObject({
      nativeFetch: true,
      sessionCookies: true,
      cookieDomains: ['telebank.co.il'],
      redirectPolicy: 'reject',
    });
    expect(headless.statusPolicy).toBeUndefined();
  });

  it('logs in cold under no auth scheme, keeping the bank text out', async () => {
    const { call } = await loadModule();
    expect(call).toMatchObject({
      flow: 'sms-otp',
      envelope: {},
      authScheme: 'none',
      omitBankText: true,
    });
    expect(call.persistentAuth).toBeUndefined();
    expect(call.warmStart).toBeUndefined();
  });
});

describe('Discount login config — headers', () => {
  it('sends the UA, origin and cookie-echoed routing headers on every call', async () => {
    const { call } = await loadModule();
    expect(call.staticHeaders).toEqual({
      'user-agent': UA,
      origin: ORIGIN,
      language: '@cookie:language?HEBREW',
      site: '@cookie:site?retail',
      uuid: '@cookie:tuuid?',
      'x-xsrf-token': '@cookie-strict:XSRF-TOKEN',
      businessprocessid: '',
    });
  });

  it.each([
    { name: 'prime', expected: LOGIN_HEADERS },
    {
      name: 'encryptionKey',
      expected: { ...LOGIN_HEADERS, 'content-type': 'application/json' },
    },
    { name: 'logon', expected: { ...LOGIN_HEADERS, 'content-type': 'application/json' } },
    { name: 'landing', expected: { accept: 'text/html', referer: LOGIN_PAGE } },
  ])('$name sends its own accept, referer and account headers', async ({ name, expected }) => {
    const { call } = await loadModule();
    const step = stepNamed(call, name);
    const headers = hydratedHeaders(step, call);
    expect(headers).toStrictEqual(expected);
  });
});

describe('Discount login config — credentials', () => {
  it.each([
    { title: 'well-formed creds', creds: CREDS, isSound: true },
    { title: 'an id with a letter', creds: { ...CREDS, id: '12345678A' }, isSound: false },
    {
      title: 'a password past latin-1',
      creds: { ...CREDS, password: 'p\u20acss' },
      isSound: false,
    },
    { title: 'a user code past latin-1', creds: { ...CREDS, num: 'N\u20ac1' }, isSound: false },
    { title: 'a blank user code', creds: { ...CREDS, num: ' ' }, isSound: false },
  ])('$title → sound $isSound, before any call', async ({ creds, isSound }) => {
    const { call } = await loadModule();
    const verdict = checkRequiredCreds(call, creds);
    const expected = isSound ? true : [GENERIC, expect.any(String)];
    const result = verdictOf(verdict);
    expect(result).toEqual(expected);
  });

  it.each([
    { customerId: '123456789', uid: UID },
    { customerId: '1234', uid: '00001000001234' },
    { customerId: '9123456789', uid: '00009123456789' },
  ])('formats id $customerId as $uid, as the web app does', async ({ customerId, uid }) => {
    const { call } = await loadModule();
    const creds = { ...CREDS, id: customerId };
    const derived = applyDerivedCarry({ config: call, creds, carry: {} });
    const carry = verdictOf(derived) as Record<string, JsonValue>;
    expect(carry.uid).toBe(uid);
  });

  it('binds the login to the formatted id by its MD5', async () => {
    const { call } = await loadModule();
    const derived = applyDerivedCarry({ config: call, creds: CREDS, carry: {} });
    const carry = verdictOf(derived);
    expect(carry).toEqual({ uid: UID, uidMd5: UID_MD5 });
  });

  it.each([{ customerId: '1123456789' }, { customerId: '91234567890' }])(
    'refuses id $customerId before any call',
    async ({ customerId }) => {
      const { call } = await loadModule();
      const creds = { ...CREDS, id: customerId };
      const derived = applyDerivedCarry({ config: call, creds, carry: {} });
      const result = verdictOf(derived);
      expect(result).toEqual([GENERIC, 'derivedCarry: uid unformattable']);
    },
  );
});

describe('Discount login config — prime', () => {
  it('sets the routing cookies the login page expects', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'prime');
    const cookies = resolvedCookies(step, call);
    expect(cookies).toEqual({
      cssName: 'discount',
      language: 'HEBREW',
      t: 'P',
      caller: 'internet',
    });
  });

  it('reads the page as text under the 128 KiB cap and carries nothing', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'prime');
    expect(step).toMatchObject({ response: 'text', maxTextChars: 131072, extractsToCarry: {} });
  });

  it.each([
    { title: 'the app shell', text: '<app-root></app-root>', expected: { appRoot: '<app-root' } },
    {
      title: 'no app shell',
      text: '<body></body>',
      expected: [GENERIC, 'prime capture appRoot missing'],
    },
    {
      title: 'a look-alike tag',
      text: '<app-rooted>',
      expected: [GENERIC, 'prime capture appRoot missing'],
    },
    {
      title: 'two app shells',
      text: '<app-root></app-root><app-root>',
      expected: [GENERIC, 'prime capture appRoot ambiguous'],
    },
    {
      title: 'a CSRF token',
      text: '<app-root></app-root><script>var csrfToken = "x";</script>',
      expected: [GENERIC, 'prime capture csrf present'],
    },
  ])('$title → $expected', async ({ text, expected }) => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'prime');
    const verdict = captureText(step, { text });
    const result = verdictOf(verdict);
    expect(result).toEqual(expected);
  });
});

describe('Discount login config — key and login answers', () => {
  it('asks for the key with the app context and source 1', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'encryptionKey');
    const body = hydrateFixed(step.body?.shape ?? {}, call);
    expect(body).toEqual({ ...APP_CONTEXT, Source: 1 });
    expect(step.extractsToCarry).toEqual({ rsaKey: '/GetVerificationInfo/Key' });
  });

  it.each([
    { title: 'a key', rsaKey: 'syn-key', expected: { rsaKey: 'syn-key' } },
    { title: 'a number', rsaKey: 7, expected: [GENERIC, 'encryptionKey extract rsaKey invalid'] },
    {
      title: 'a key past 16 KiB',
      rsaKey: 'k'.repeat(16385),
      expected: [GENERIC, 'encryptionKey extract rsaKey invalid'],
    },
  ])('takes $title as the key → $expected.0', async ({ rsaKey, expected }) => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'encryptionKey');
    const result = ruled(step, call, { rsaKey });
    expect(result).toEqual(expected);
  });

  it.each<{ name: string; resp: JsonValue; isError: boolean }>([
    { name: 'encryptionKey', resp: { Error: { Code: 1 } }, isError: true },
    { name: 'encryptionKey', resp: { error: 'x' }, isError: true },
    { name: 'encryptionKey', resp: { actionRequired: { Kind: 'otp' } }, isError: true },
    { name: 'logon', resp: { Error: { Code: 1 } }, isError: true },
    { name: 'logon', resp: { actionRequired: 'step-up' }, isError: true },
    { name: 'logon', resp: { Error: null, error: null, actionRequired: null }, isError: false },
  ])('$name answer $resp → bank error $isError', async ({ name, resp, isError }) => {
    const { call } = await loadModule();
    const step = stepNamed(call, name);
    const verdict = guardBankError(step, resp);
    const expected = isError ? [GENERIC, `${name} bank error`] : true;
    const result = verdictOf(verdict);
    expect(result).toEqual(expected);
  });

  it('logs in with the formatted id, sealing the user code then the password', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'logon');
    const body = hydrateFixed(step.body?.shape ?? {}, call) as Record<string, JsonValue>;
    const expected = {
      ...APP_CONTEXT,
      PlatformType: 'WEB',
      Uid: UID,
      ThirdIdentifierType: 'aid',
      ThirdIdentifier: '',
      Password: '',
    };
    const keyOrder = Object.keys(body);
    const expectedOrder = Object.keys(expected);
    expect(body).toEqual(expected);
    expect(keyOrder).toEqual(expectedOrder);
    expect(step.seal).toEqual({
      kind: 'rsa-pkcs1-v15',
      keyRef: 'carry.rsaKey',
      fields: [
        { sourceRef: 'creds.num', writeTo: '/ThirdIdentifier' },
        { sourceRef: 'creds.password', writeTo: '/Password' },
      ],
    });
  });

  it('follows one 302/303 hop to the login-success answer, made as a GET', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'logon');
    expect(step.redirect).toEqual({
      maxHops: 1,
      postAsGet: true,
      allow: [
        { origin: ORIGIN, paths: ['/Lobby/gatewayAPI/loginSuccessResponse'], exactQuery: true },
      ],
    });
  });

  it.each<{ title: string; status: JsonValue | undefined; expected: unknown }>([
    { title: 'no status', status: undefined, expected: { loginStatus: 'statusAbsent' } },
    { title: 'SUCCESS', status: 'SUCCESS', expected: { loginStatus: 'statusSuccess' } },
    {
      title: 'a refusal',
      status: 'FAILURE',
      expected: [INVALID_PASSWORD, 'logon answer statusRejected'],
    },
    {
      title: 'a near miss',
      status: 'SUCCESSFUL',
      expected: [INVALID_PASSWORD, 'logon answer statusRejected'],
    },
    { title: 'null', status: null, expected: [INVALID_PASSWORD, 'logon answer statusRejected'] },
    { title: 'empty', status: '', expected: [INVALID_PASSWORD, 'logon answer statusRejected'] },
    { title: 'a number', status: 5, expected: [INVALID_PASSWORD, 'logon answer statusRejected'] },
    {
      title: 'an object',
      status: { Code: 'SUCCESS' },
      expected: [INVALID_PASSWORD, 'logon answer statusRejected'],
    },
  ])('login status $title → $expected', async ({ status, expected }) => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'logon');
    const login: JsonValue =
      status === undefined ? { MI6: UID_MD5 } : { MI6: UID_MD5, Status: status };
    const verdict = classifyAnswer(step, { Login: login });
    const result = verdictOf(verdict);
    expect(result).toEqual(expected);
  });

  it.each([
    { title: 'the id MD5', mi6: UID_MD5, expected: { mi6: UID_MD5, uidMd5: UID_MD5 } },
    {
      title: 'another MD5',
      mi6: '0'.repeat(32),
      expected: [GENERIC, 'logon extract mi6 mismatch'],
    },
    { title: 'a number', mi6: 7, expected: [GENERIC, 'logon extract mi6 invalid'] },
  ])('takes $title as MI6 → $expected.0', async ({ mi6, expected }) => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'logon');
    expect(step.extractsToCarry).toEqual({ mi6: '/Login/MI6' });
    const result = ruled(step, call, { mi6, uidMd5: UID_MD5 });
    expect(result).toEqual(expected);
  });
});

describe('Discount login config — landing', () => {
  it('sets the login and retail-routing cookies', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'landing');
    const cookies = resolvedCookies(step, call);
    expect(cookies).toEqual({ mi6: CARRY.mi6, fte: 'true', newRetail: '1' });
  });

  it('opens the retail app shell, through one hop to its canonical path', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'landing');
    expect(step).toMatchObject({
      response: 'document',
      documentMarker: '<apollo-root',
      extractsToCarry: {},
      redirect: {
        maxHops: 1,
        allow: [{ origin: ORIGIN, paths: ['/apollo/retail3/'], exactQuery: true }],
      },
    });
    expect(step.redirect).not.toHaveProperty('postAsGet');
  });
});
