/**
 * Yahav native login config. The build-time validator
 * accepts it with its headless block; each login step hydrates to the request
 * the protocol trace pinned (body, key order, headers and the generated key
 * material); each step's rules refuse what the trace never showed; and a warm
 * start resumes at the token step, past both cold-only calls.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test rule
 * (Pipeline tests don't statically import from Registry/Config).
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
  JsonValueTemplate,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { checkRequiredCreds } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RequiredCreds.js';
import { applyExtractRules } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.extractRules.js';
import { hydrate } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const CONFIG_MODULE = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigYahav.js';

/** The bank's headless block, as the build-time validator reads it. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['transport'], false>;

/** The Yahav login config and its headless block. */
interface IYahavModule {
  readonly call: IApiDirectCallConfig;
  readonly headless: HeadlessBlock;
}

const ORIGIN = 'https://mobile.yahav.co.il';
const UA = 'BankApiInteroperabilityResearch/1.0';
const CLIENT_KEY = '48bcd201-f567-48a1-9e59-1b05f566b0f5';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

const CREDS = { num: 'AB1234', nationalID: '012345678', password: 'syn-p\u00e4ss' } as const;
const CARRY = {
  deviceId: 'ab'.repeat(32),
  clientId: 'syn-client',
  clientSecret: 'syn-secret',
  csr: 'syn-csr',
  mag: 'bWFn',
} as const;

/** base64 of `CARRY.deviceId`'s text. */
const DEVICE_ID_B64 =
  'YWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYmFiYWJhYg==';

/** What the protocol trace sent at each step, for the values above. */
const EXPECTED_HEADERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  prime: { accept: 'application/json', 'user-agent': UA, 'device-id': DEVICE_ID_B64 },
  register: {
    accept: '*/*',
    'user-agent': UA,
    'cert-format': 'pem',
    'enable-multi-device-login': 'ZmFsc2U=',
    'device-id': DEVICE_ID_B64,
    'device-name': 'SXNyYWVsaUJhbmtTY3JhcGVycw==',
    'create-session': 'true',
    // base64 of the UTF-8 'AB1234-012345678:syn-päss'.
    authorization: 'Basic QUIxMjM0LTAxMjM0NTY3ODpzeW4tcMOkc3M=',
    'client-authorization': 'Basic c3luLWNsaWVudDpzeW4tc2VjcmV0',
  },
  logon: { accept: 'application/json', 'user-agent': UA, 'mag-identifier': CARRY.mag },
};

/** The token form, in the order the app writes it. */
const TOKEN_FORM = {
  username: 'AB1234-012345678',
  password: CREDS.password,
  client_id: CARRY.clientId,
  client_secret: CARRY.clientSecret,
  scope: 'openid msso profile',
  grant_type: 'password',
};

/**
 * Load the Yahav config module.
 * @returns Its login config and headless block.
 */
async function loadModule(): Promise<IYahavModule> {
  const loaded = (await import(CONFIG_MODULE)) as Record<string, unknown>;
  const call = loaded.default as IApiDirectCallConfig;
  const headless = loaded.YAHAV_TRANSPORT as HeadlessBlock;
  return { call, headless };
}

/**
 * Hydrate a template with the fixed creds and carry above.
 * @param template - Body, header or subject template.
 * @param config - The config the template belongs to.
 * @returns The hydrated value; fails the test when hydration fails.
 */
function hydrateFixed(template: JsonValueTemplate, config: IApiDirectCallConfig): JsonValue {
  const result = hydrate(template, { carry: CARRY, creds: CREDS, config });
  if (!isOk(result)) throw new TypeError(result.errorMessage);
  return result.value;
}

/**
 * The named login step.
 * @param call - Login config.
 * @param name - Step name.
 * @returns The step; fails the test when absent.
 */
function stepNamed(call: IApiDirectCallConfig, name: string): IStepConfig {
  const step = call.steps.find(candidate => candidate.name === name);
  if (step === undefined) throw new TypeError(`no ${name} step`);
  return step;
}

/**
 * Hydrate every header of a step.
 * @param step - Login step.
 * @param call - Login config.
 * @returns Header name → hydrated text.
 */
function hydratedHeaders(step: IStepConfig, call: IApiDirectCallConfig): Record<string, JsonValue> {
  const entries = Object.entries(step.headers ?? {});
  const hydrated = entries.map(([name, template]) => [name, hydrateFixed(template, call)]);
  return Object.fromEntries(hydrated) as Record<string, JsonValue>;
}

/**
 * Whether a step's rules accept the slots it read.
 * @param step - Login step.
 * @param call - Login config.
 * @param carry - The slots as read from the answer.
 * @returns True when every rule passes.
 */
function isAccepted(
  step: IStepConfig,
  call: IApiDirectCallConfig,
  carry: Record<string, JsonValue>,
): boolean {
  const scope = { carry, creds: CREDS, config: call };
  const input = { step, resp: {}, carry, stepUrl: ORIGIN, scope };
  return applyExtractRules(input).success;
}

describe('Yahav native login config — wiring', () => {
  it('passes the build-time validator with its headless block', async () => {
    const { call, headless } = await loadModule();
    const result = validateApiDirectConfig({ call, transport: headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('initializes, registers, then takes a token, each on its own URL', async () => {
    const { call, headless } = await loadModule();
    const named = call.steps.map(step => [step.name, step.urlTag]);
    expect(named).toEqual([
      ['prime', 'auth.prime'],
      ['register', 'auth.bind'],
      ['logon', 'auth.logon'],
    ]);
    expect(headless.paths).toEqual({
      'auth.prime': `${ORIGIN}/connect/client/initialize`,
      'auth.bind': `${ORIGIN}/connect/device/register`,
      'auth.logon': `${ORIGIN}/auth/oauth/v2/token`,
    });
  });

  it('presents the device certificate only to the token call, on the mobile origin', async () => {
    const { call, headless } = await loadModule();
    const certified = call.steps.filter(step => step.clientCert !== undefined);
    const logon = stepNamed(call, 'logon');
    expect(certified).toEqual([logon]);
    expect(logon.clientCert).toEqual({ key: 'carry.certKeyPem', cert: 'carry.certPem' });
    expect(headless.clientCert).toEqual({ mode: 'dynamic', origin: ORIGIN });
    expect(headless.nativeFetch).toBeUndefined();
    expect(headless.requiresClientCert).toBeUndefined();
  });

  it('keeps a cookie session on the bank domain', async () => {
    const { headless } = await loadModule();
    expect(headless).toMatchObject({ sessionCookies: true, cookieDomains: ['yahav.co.il'] });
  });
});

describe('Yahav native login config — requests', () => {
  it.each(['prime', 'register', 'logon'])('%s sends the traced headers', async name => {
    const { call } = await loadModule();
    const step = stepNamed(call, name);
    const headers = hydratedHeaders(step, call);
    expect(headers).toEqual(EXPECTED_HEADERS[name]);
  });

  it('initializes the client with its public key and a fresh nonce', async () => {
    const { call } = await loadModule();
    const prime = stepNamed(call, 'prime');
    const body = hydrateFixed(prime.body?.shape ?? {}, call) as Record<string, JsonValue>;
    const { nonce, ...fixed } = body;
    const nonceText = typeof nonce === 'string' ? nonce : '';
    expect(fixed).toEqual({ client_id: CLIENT_KEY });
    expect(nonceText).toMatch(UUID);
    expect(prime.encoding).toBe('form-latin1');
    expect(prime.generate).toEqual([
      { kind: 'rsa-key', bits: 2048, spkiSha256HexInto: 'deviceId' },
    ]);
  });

  it('registers a fresh key through a CSR naming the bank, the device and the user', async () => {
    const { call } = await loadModule();
    const register = stepNamed(call, 'register');
    const [keyGen, csrGen] = register.generate ?? [];
    expect(keyGen).toEqual({ kind: 'rsa-key', bits: 2048, keyInto: 'certKeyPem' });
    expect(csrGen).toMatchObject({ kind: 'pkcs10-csr', keyRef: 'carry.certKeyPem', into: 'csr' });
    const subject = csrGen.kind === 'pkcs10-csr' ? csrGen.subject : [];
    const named = subject.map(entry => [entry.attr, hydrateFixed(entry.value, call)]);
    expect(named).toEqual([
      ['O', 'Bank Yahav'],
      ['DC', 'IsraeliBankScrapers'],
      ['OU', CARRY.deviceId],
      ['CN', 'AB1234-012345678'],
    ]);
  });

  it('sends the CSR as the bare text body and reads the certificate as text', async () => {
    const { call } = await loadModule();
    const register = stepNamed(call, 'register');
    const body = hydrateFixed(register.body?.shape ?? {}, call);
    expect(body).toEqual({ text: CARRY.csr });
    expect(register).toMatchObject({ encoding: 'text', response: 'text' });
    expect(register.extractsToCarry).toEqual({ certPem: '/text' });
    expect(register.extractRules?.certPem).toEqual({
      pemCertificate: { keyRef: 'carry.certKeyPem' },
    });
  });

  it('asks for a password grant, fields in the order the app writes them', async () => {
    const { call } = await loadModule();
    const logon = stepNamed(call, 'logon');
    const body = hydrateFixed(logon.body?.shape ?? {}, call) as Record<string, JsonValue>;
    expect(body).toEqual(TOKEN_FORM);
    const sentOrder = Object.keys(body);
    const appOrder = Object.keys(TOKEN_FORM);
    expect(sentOrder).toEqual(appOrder);
    expect(logon.encoding).toBe('form-latin1');
  });
});

/** Answers each step accepts, for the cases below to vary. */
const CLIENT_ANSWER = { clientId: 'syn-client', clientSecret: 'syn-secret' };
const DEVICE_ANSWER = { deviceStatus: 'activated', mag: CARRY.mag };
const TOKEN_ANSWER = { token: 'syn.token-1', tokenType: 'Bearer', expiresIn: 600 };

/** One answer, the step that reads it and whether the step accepts it. */
interface IAnswerCase {
  readonly step: string;
  readonly label: string;
  readonly carry: Record<string, JsonValue>;
  readonly isExpected: boolean;
}

/** One answer row: step, label, slots read, whether the step accepts them. */
type AnswerRow = readonly [string, string, Record<string, JsonValue>, boolean];

const ANSWER_ROWS: readonly AnswerRow[] = [
  ['prime', 'issued credentials', CLIENT_ANSWER, true],
  ['prime', 'a 257-char client id', { ...CLIENT_ANSWER, clientId: 'c'.repeat(257) }, false],
  ['prime', 'a numeric client secret', { ...CLIENT_ANSWER, clientSecret: 7 }, false],
  ['prime', 'a control char in the secret', { ...CLIENT_ANSWER, clientSecret: 's\n' }, false],
  ['logon', 'a bearer token', TOKEN_ANSWER, true],
  ['logon', 'a lower-case bearer', { ...TOKEN_ANSWER, tokenType: 'bearer' }, true],
  ['logon', 'a mac token', { ...TOKEN_ANSWER, tokenType: 'mac' }, false],
  ['logon', 'a zero lifetime', { ...TOKEN_ANSWER, expiresIn: 0 }, false],
  ['logon', 'a fractional lifetime', { ...TOKEN_ANSWER, expiresIn: 1.5 }, false],
  ['logon', 'a text lifetime', { ...TOKEN_ANSWER, expiresIn: '600' }, false],
  ['logon', 'a token with a line break', { ...TOKEN_ANSWER, token: 'a\nb' }, false],
  ['logon', 'a 32769-char token', { ...TOKEN_ANSWER, token: 't'.repeat(32769) }, false],
  ['register', 'an activated device with a base64 mag', DEVICE_ANSWER, true],
  ['register', 'a pending device', { ...DEVICE_ANSWER, deviceStatus: 'pending' }, false],
  ['register', 'a mag that is not base64', { ...DEVICE_ANSWER, mag: 'm@g!' }, false],
  ['register', 'a mag carrying a header break', { ...DEVICE_ANSWER, mag: 'bWFn\r\nx-a: b' }, false],
  ['register', 'a 4100-char mag', { ...DEVICE_ANSWER, mag: 'A'.repeat(4100) }, false],
];

const ANSWER_CASES: readonly IAnswerCase[] = ANSWER_ROWS.map(
  ([step, label, carry, isExpected]): IAnswerCase => ({ step, label, carry, isExpected }),
);

/**
 * A step with its certificate rule dropped, so its header rules are tested
 * alone (the certificate rule needs a real key and certificate).
 * @param step - Login step.
 * @returns The step without the `certPem` rule.
 */
function withoutCertRule(step: IStepConfig): IStepConfig {
  const rules = Object.entries(step.extractRules ?? {});
  const kept = rules.filter(([slot]) => slot !== 'certPem');
  return { ...step, extractRules: Object.fromEntries(kept) };
}

describe('Yahav native login config — answers', () => {
  it.each(ANSWER_CASES)('$step: $label → accepted=$isExpected', async answer => {
    const { call } = await loadModule();
    const named = stepNamed(call, answer.step);
    const step = withoutCertRule(named);
    const isAnswerAccepted = isAccepted(step, call, answer.carry);
    expect(isAnswerAccepted).toBe(answer.isExpected);
  });

  it('reads the device state and the mag identifier from the answer headers', async () => {
    const { call } = await loadModule();
    const register = stepNamed(call, 'register');
    expect(register.headerExtractsToCarry).toEqual({
      deviceStatus: { header: 'device-status' },
      mag: { header: 'mag-identifier' },
    });
  });

  it('reports a register 401 as a wrong password, and types no other step by status', async () => {
    const { call } = await loadModule();
    const register = stepNamed(call, 'register');
    const typed = call.steps.filter(step => step.httpFailureMap !== undefined);
    const typedNames = typed.map(step => step.name);
    expect(register.httpFailureMap).toEqual({ '401': ScraperErrorTypes.InvalidPassword });
    expect(typedNames).toEqual(['register']);
  });
});

describe('Yahav native login config — credentials and warm start', () => {
  it('refuses a password the token form cannot encode, before any request', async () => {
    const { call } = await loadModule();
    const sound = checkRequiredCreds(call, CREDS);
    const hebrew = checkRequiredCreds(call, { ...CREDS, password: 'syn-\u05d0' });
    expect(sound.success).toBe(true);
    expect(hebrew).toMatchObject({
      success: false,
      errorMessage: 'Missing or malformed credentials: password',
    });
  });

  it('refuses a num the token form cannot encode, before the register call', async () => {
    const { call } = await loadModule();
    const hebrew = checkRequiredCreds(call, { ...CREDS, num: 'syn-\u05d0' });
    expect(hebrew).toMatchObject({
      success: false,
      errorMessage: 'Missing or malformed credentials: num',
    });
  });

  it('resumes a warm start at the token call, past both cold-only calls', async () => {
    const { call } = await loadModule();
    const index = call.warmStart?.fromStepIndex ?? -1;
    expect(call.steps[index]?.name).toBe('logon');
    expect(call.warmStart).toMatchObject({
      kind: 'carry-bundle',
      credsField: 'otpLongTermToken',
      validation: 'bank-call',
      provider: 'yahav-native',
      accountFields: ['num', 'nationalID'],
      slots: ['clientId', 'clientSecret', 'certKeyPem', 'certPem', 'mag'],
      cookies: true,
      coldFallback: 'auth-rejected',
    });
  });

  it('hands the scrape a bearer token and the mag identifier, nothing else', async () => {
    const { call } = await loadModule();
    expect(call).toMatchObject({
      authScheme: 'bearer',
      sessionCarry: ['mag'],
      cookieHandoff: 'isolate',
      authRecovery: 'whole-scrape',
      omitBankText: true,
    });
  });
});
