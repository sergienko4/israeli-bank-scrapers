/**
 * Beinleumi api-direct login config. The build-time
 * validator accepts it with its headless block; each step hydrates to the
 * request the protocol trace pinned — the entry page, the Transmit key
 * exchange, login and assertions, the portal hand-off and the SSO token — and
 * the config remembers the device the bank names, so a known device logs in
 * without a code.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test rule
 * (Pipeline tests don't statically import from Registry/Config).
 */

import { release, type as osType } from 'node:os';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { captureText } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Captures/RunStep.textCapture.js';
import {
  CARRY,
  ENTRY,
  ENVELOPE_HEADERS,
  FINGERPRINT,
  hydratedHeaders,
  hydrateFixed,
  loadModule,
  ORIGIN,
  SERVLET,
  stepNamed,
  TRANSMIT_HEADERS,
  UA,
  withoutSlot,
} from './BeinleumiConfigTestHelpers.js';

const TRANSMIT = `${ORIGIN}//api/v2/auth`;
const AID = 'rest_app_031';
const SEALED = {
  kind: 'ecdh-aes-cbc',
  mode: 'sealed',
  keyRef: 'carry.envelopeKey',
  sessionRef: 'carry.envelopeSession',
} as const;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

/** The SSO calls' shared headers, sent from the landing page. */
const SSO_HEADERS = {
  accept: 'application/json',
  'user-agent': UA,
  origin: ORIGIN,
  referer: CARRY.landingUrl,
};

/** An entry page's script, stating the bank number and client address. */
const ENTRY_SCRIPT = 'var bankNum = \'031\';\nvar client_ip = "192.0.2.7";';

/** Carry before the bank names a device. */
const COLD_CARRY = withoutSlot(CARRY, 'did');

describe('Beinleumi api-direct login config — wiring', () => {
  it('passes the build-time validator with its headless block', async () => {
    const { call, headless } = await loadModule();
    const result = validateApiDirectConfig({ call, transport: headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('primes, opens a Transmit session, hands off to the portal, then takes the SSO token', async () => {
    const { call } = await loadModule();
    const named = call.steps.map(step => [step.name, step.urlTag, step.method ?? 'POST']);
    expect(named).toEqual([
      ['prime', 'auth.prime', 'GET'],
      ['encryptionKey', 'auth.encryptionKey', 'POST'],
      ['login', 'auth.login', 'POST'],
      ['assertPassword', 'auth.assert', 'POST'],
      ['otpInit', 'auth.assert', 'POST'],
      ['assertOtp', 'auth.assert', 'POST'],
      ['logon', 'auth.logon', 'POST'],
      ['landing', 'auth.landing', 'GET'],
      ['bootstrap', 'auth.bootstrap', 'POST'],
      ['sessionToken', 'identity.sessionToken', 'GET'],
    ]);
  });

  it('names each call on the online origin', async () => {
    const { headless } = await loadModule();
    expect(headless.paths).toEqual({
      'auth.prime': ENTRY,
      'auth.encryptionKey': `${TRANSMIT}/key_exchange`,
      'auth.login': `${TRANSMIT}/login`,
      'auth.assert': `${TRANSMIT}/assert`,
      'auth.logon': SERVLET,
      'auth.bootstrap': `${ORIGIN}/MatafRestApiService/rest/authSSO/authSSO`,
      'identity.sessionToken': `${ORIGIN}/appsng/bff-portal-shell/api/v1/autorization/authorize`,
    });
    expect(headless).toMatchObject({ identityBase: `${ORIGIN}/`, graphql: `${ORIGIN}/` });
  });

  it('runs over native fetch in one cookie session, refusing redirects and non-200 success', async () => {
    const { headless } = await loadModule();
    const policy = headless.statusPolicy ?? {};
    const refused = Object.keys(policy).map(Number);
    const isEachFail = Object.values(policy).every(action => action === 'fail');
    expect(headless).toMatchObject({
      nativeFetch: true,
      sessionCookies: true,
      redirectPolicy: 'reject',
      mediaTypes: { json: 'application/json' },
      strictUtf8: true,
    });
    const nonOk = Array.from({ length: 99 }, (_unused, index) => 201 + index);
    expect(refused).toEqual(nonOk);
    expect(isEachFail).toBe(true);
    expect(headless.cookieDomains).toBeUndefined();
  });

  it('remembers the device the bank names, bound to the user, with no warm start', async () => {
    const { call } = await loadModule();
    expect(call.persistentAuth).toEqual({
      kind: 'device-memory',
      provider: 'beinleumi-web',
      deviceIdField: 'did',
      accountField: 'username',
    });
    expect(call.warmStart).toBeUndefined();
  });

  it('hands the scrape only the SSO authorization and the landing URL, under no auth scheme', async () => {
    const { call } = await loadModule();
    expect(call).toMatchObject({
      flow: 'sms-otp',
      authScheme: 'none',
      omitBankText: true,
      requiredCreds: { username: 'nonEmpty', password: 'nonEmpty' },
      sessionCarry: ['authorization', 'landingUrl'],
    });
  });

  it('opens each flow with a fresh upper-case flow id and the lower-case user id', async () => {
    const { call } = await loadModule();
    expect(call.seedCarryFromCreds).toEqual([
      { field: 'flowId', bootstrap: { kind: 'random-hex', bytes: 32, isUpperCase: true } },
    ]);
    expect(call.derivedCarry).toEqual([
      { into: 'uid', parts: ['creds.username'], transform: 'lower' },
    ]);
  });

  it('reports the device the way the web SDK does', async () => {
    const { call } = await loadModule();
    const shape = call.fingerprint?.shape ?? {};
    const hydrated = hydrateFixed(shape, call) as Record<string, Record<string, JsonValue>>;
    expect(typeof hydrated.metadata.timestamp).toBe('number');
    expect(hydrated.metadata.physical_app_id).toBe('online.fibi.co.il');
    expect(hydrated.content).toEqual({
      device_details: {
        os_type: osType(),
        os_version: release(),
        device_model: `Node.js ${process.versions.node}`,
        device_platform: process.platform,
        timezone_offset: new Date().getTimezoneOffset(),
      },
      location: { enabled: false },
    });
  });
});

describe('Beinleumi api-direct login config — Transmit requests', () => {
  it.each(['encryptionKey', 'login', 'assertPassword', 'otpInit', 'assertOtp'])(
    '%s sends the fixed Transmit headers',
    async name => {
      const { call } = await loadModule();
      const step = stepNamed(call, name);
      const headers = hydratedHeaders(step, call);
      expect(headers).toEqual(TRANSMIT_HEADERS);
    },
  );

  it('exchanges keys with the generated public point and the SDK probe text', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'encryptionKey');
    const body = hydrateFixed(step.body?.shape ?? {}, call);
    expect(body).toEqual({
      headers: [ENVELOPE_HEADERS[0], { type: 'key_exchange', scheme: 2, y: CARRY.ecdhPublic }],
      data: { r: 'Hello Encrypted World' },
    });
    expect(step.codec).toEqual({
      kind: 'ecdh-aes-cbc',
      mode: 'exchange',
      privateRef: 'carry.ecdhPrivate',
      keyInto: 'envelopeKey',
      sessionInto: 'envelopeSession',
    });
  });

  it('logs in with the entry page context and the fingerprint, sealed', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'login');
    const body = hydrateFixed(step.body?.shape ?? {}, call);
    expect(body).toEqual({
      headers: ENVELOPE_HEADERS,
      data: {
        policy_request_id: 'Login',
        params: { bankId: CARRY.bankNum, client_ip: CARRY.client_ip },
        collection_result: FINGERPRINT,
      },
    });
    expect(step.codec).toEqual(SEALED);
  });

  it.each(['encryptionKey', 'login'])('%s names the device only once it is known', async name => {
    const { call } = await loadModule();
    const query = stepNamed(call, name).queryTemplate ?? {};
    const cold = hydrateFixed(query, call, COLD_CARRY);
    const known = hydrateFixed(query, call);
    expect(cold).toEqual({ aid: AID });
    expect(known).toEqual({ aid: AID, did: CARRY.did });
  });

  it.each(['assertPassword', 'otpInit', 'assertOtp'])(
    '%s names the app, the device and the session, sealed',
    async name => {
      const { call } = await loadModule();
      const step = stepNamed(call, name);
      const query = hydrateFixed(step.queryTemplate ?? {}, call);
      expect(query).toEqual({ aid: AID, did: CARRY.did, sid: CARRY.sid });
      expect(step.codec).toEqual(SEALED);
    },
  );

  it('asserts the password against the login challenge', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'assertPassword');
    const body = hydrateFixed(step.body?.shape ?? {}, call);
    expect(body).toEqual({
      headers: ENVELOPE_HEADERS,
      data: {
        action: 'authentication',
        assert: 'authenticate',
        assertion_id: CARRY.pwdAssertionId,
        fch: CARRY.challenge,
        data: { password: 'syn-p\u00e4ss' },
        method: 'password',
      },
    });
    expect(step.runIf).toBeUndefined();
  });

  it('asks for the SMS code on its one target only while the bank has not sent it', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'otpInit');
    const body = hydrateFixed(step.body?.shape ?? {}, call);
    expect(body).toEqual({
      headers: ENVELOPE_HEADERS,
      data: {
        action: 'authentication',
        assert: 'otp',
        assertion_id: CARRY.otpAssertionId,
        fch: CARRY.challenge,
        data: { target_id: CARRY.otpTargetId, channel_index: 0 },
        method: 'otp',
      },
    });
    expect(step.runIf).toEqual({ carry: 'authBranch', oneOf: ['otp-generate'] });
  });

  it('asserts the typed code, of the stated length, against the login challenge', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'assertOtp');
    const body = hydrateFixed(step.body?.shape ?? {}, call);
    expect(body).toEqual({
      headers: ENVELOPE_HEADERS,
      data: {
        action: 'authentication',
        assert: 'authenticate',
        assertion_id: CARRY.otpAssertionId,
        fch: CARRY.challenge,
        data: { otp: CARRY.otpCode },
        method: 'otp',
      },
    });
    expect(step.runIf).toEqual({ carry: 'authBranch', oneOf: ['otp-generate', 'otp-validate'] });
    expect(step.preHook).toEqual({
      awaitCredsField: 'otpCodeRetriever',
      intoCarryField: 'otpCode',
      valuePattern: '^[0-9]{4,10}$',
      valueLengthRef: 'carry.otpLength',
    });
  });

  it.each([
    ['assertPassword', ScraperErrorTypes.InvalidPassword],
    ['otpInit', ScraperErrorTypes.Generic],
    ['assertOtp', ScraperErrorTypes.InvalidOtp],
  ] as const)('%s fails an assertion error as %s', async (name, errorType) => {
    const { call } = await loadModule();
    const step = stepNamed(call, name);
    expect(step.failIfPresent).toEqual(['/data/assertion_error_code']);
    expect(step.bankErrorType).toBe(errorType);
  });
});

describe('Beinleumi api-direct login config — portal requests', () => {
  it('reads the entry page as HTML and generates the session key pair', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'prime');
    const headers = hydratedHeaders(step, call);
    expect(headers).toEqual({ accept: 'text/html', 'user-agent': UA });
    expect(step).toMatchObject({ response: 'text', maxTextChars: 2097152, mediaType: 'text/html' });
    expect(step.generate).toEqual([
      {
        kind: 'ecdh-key',
        curve: 'secp256k1',
        publicInto: 'ecdhPublic',
        privateInto: 'ecdhPrivate',
      },
    ]);
    expect(step.formCapture).toEqual({
      form: 'loginServlet',
      into: 'loginForm',
      action: SERVLET,
      required: ['user', 'passwordEnc', 'bankId'],
      forbidden: ['password'],
      minFields: 3,
      maxFields: 32,
    });
  });

  it.each([
    ['states each once', ENTRY_SCRIPT, { bankNum: '031', client_ip: '192.0.2.7' }],
    [
      'states the bank number twice',
      `${ENTRY_SCRIPT}\nbankNum = "046";`,
      'prime capture bankNum ambiguous',
    ],
    ['omits the client address', "var bankNum = '031';", 'prime capture client_ip missing'],
  ] as const)('reads the entry page context when the page %s', async (_label, text, expected) => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'prime');
    const verdict = captureText(step, { text });
    const read = verdict.success ? verdict.value : verdict.errorMessage;
    expect(read).toEqual(expected);
  });

  it('posts the captured login form with the issued token and the user name', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'logon');
    const body = hydrateFixed(step.body?.shape ?? {}, call);
    const headers = hydratedHeaders(step, call);
    expect(body).toEqual({ ...CARRY.loginForm, passwordEnc: CARRY.token, user: 'SynUser' });
    expect(step.encoding).toBe('form-utf8');
    expect(headers).toEqual({
      accept: 'text/html,application/xhtml+xml',
      'user-agent': UA,
      origin: ORIGIN,
      referer: ENTRY,
    });
    expect(step).toMatchObject({ response: 'text', maxTextChars: 2097152, mediaType: 'text/html' });
  });

  it('reads the hand-off target from the logon page, on the portal only', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'logon');
    const portal = {
      origin: ORIGIN,
      anyPathExcept: ['logout', 'changepass', 'recovery', 'resetpassword'],
    };
    expect(step.locationCapture).toEqual({ into: 'handoffUrl', userAgent: UA, url: [portal] });
  });

  it('follows the hand-off to the portal, keeping where it landed', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'landing');
    const headers = hydratedHeaders(step, call);
    const portal = {
      origin: ORIGIN,
      anyPathExcept: ['logout', 'changepass', 'recovery', 'resetpassword'],
    };
    expect(headers).toEqual({ accept: 'text/html,application/xhtml+xml', 'user-agent': UA });
    expect(step).toMatchObject({
      urlFromCarry: 'handoffUrl',
      redirect: { maxHops: 3, allow: [portal] },
      finalUrlInto: 'landingUrl',
      response: 'document',
      mediaType: 'text/html',
    });
  });

  it('asks the shell for an SSO code from the landing page', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'bootstrap');
    const body = hydrateFixed(step.body?.shape ?? {}, call);
    const headers = hydratedHeaders(step, call);
    expect(body).toEqual({ TPPName: 'shell' });
    expect(headers).toEqual(SSO_HEADERS);
    expect(step).toMatchObject({ response: 'text', maxTextChars: 131072 });
  });

  it('trades the code for the authorization header the scrape sends', async () => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'sessionToken');
    const rawQuery = hydrateFixed({ $join: step.rawQuery ?? { parts: [] } }, call);
    const { 'x-fibi-transaction-id': transactionId, ...headers } = hydratedHeaders(step, call);
    expect(rawQuery).toBe(`code=${CARRY.ssoCode}`);
    expect(headers).toEqual(SSO_HEADERS);
    const isUuid = UUID.test(typeof transactionId === 'string' ? transactionId : '');
    expect(isUuid).toBe(true);
    expect(step.headerExtractsToCarry).toEqual({ authorization: { header: 'authorization' } });
    expect(step).toMatchObject({ response: 'document', strictUtf8: false });
  });
});
