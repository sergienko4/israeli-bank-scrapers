/**
 * N10 / N44 — a step naming `seal` seals credentials into its body before
 * the request: each source comes from creds, the key from carry, and neither
 * the plaintext nor the sealed value enters carry. A block-xor seal writes
 * one field; an `rsa-pkcs1-v15` seal writes one field per source.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type {
  IApiDirectCallConfig,
  IBodyTemplate,
  IPostStep,
  ISealFieldConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';
import {
  makePkcs1Key,
  makeSealKey,
  openPkcs1,
  openSeal,
  SEAL_PARAMS,
} from '../../../../../Helpers/SealOpener.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const KEY = makeSealKey();
const PKCS1_KEY = makePkcs1Key();
const PASSWORD = 'syn-Pass!7 é';
const NUM = 'syn-num-42';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const SEAL_CONFIG: ISealFieldConfig = {
  kind: 'rsa-pkcs1-block-xor',
  sourceRef: 'creds.password',
  modulusRef: 'carry.modulus',
  writeTo: '/credentials',
  params: SEAL_PARAMS,
};

const SEAL_STEP: IPostStep = {
  name: 'login',
  urlTag: 'auth.login',
  encoding: 'form',
  body: {
    shape: {
      identifier: { $ref: 'creds.userCode' },
      credentials: { $literal: '' },
      authType: { $literal: 'VERSAFE' },
    },
  },
  seal: SEAL_CONFIG,
  extractsToCarry: { state: '/state' },
};

const PKCS1_STEP: IPostStep = {
  name: 'logon',
  urlTag: 'auth.login',
  body: {
    shape: {
      Uid: { $literal: 'syn-uid' },
      ThirdIdentifier: { $literal: '' },
      Password: { $literal: '' },
    },
  },
  seal: {
    kind: 'rsa-pkcs1-v15',
    keyRef: 'carry.rsaKey',
    fields: [
      { sourceRef: 'creds.num', writeTo: '/ThirdIdentifier' },
      { sourceRef: 'creds.password', writeTo: '/Password' },
    ],
  },
  extractsToCarry: { state: '/state' },
};

beforeAll((): void => {
  registerWkUrl('auth.login', HINT, `${ORIGIN}/authenticate/login`);
});

/**
 * Template scope with the synthetic credentials and a modulus slot.
 * @param modulus - Value of `carry.modulus`.
 * @returns Template scope.
 */
function scopeWith(modulus: string): ITemplateScope {
  const creds = { userCode: 'syn-user', password: PASSWORD };
  return { carry: { modulus }, creds, config: PLAIN_CONFIG, keypair: undefined };
}

/**
 * Point fetch at a fake that answers every call with a landing state.
 * @returns The fake, for request assertions.
 */
function serveState(): IFetchFake {
  const fake = fakeFetch((): Response => Response.json({ state: 'LANDPAGE' }));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * The form the first request sent.
 * @param fake - The fetch fake.
 * @returns Its body as form fields.
 */
function sentForm(fake: IFetchFake): URLSearchParams {
  const body = fake.calls[0].init.body as string;
  return new URLSearchParams(body);
}

/**
 * The JSON body sent by the first request.
 * @param fake - The fetch fake.
 * @returns Parsed request body.
 */
function sentJson(fake: IFetchFake): unknown {
  const body = fake.calls[0].init.body;
  if (typeof body !== 'string') throw new TypeError('Expected a JSON request body');
  const parsed: unknown = JSON.parse(body);
  return parsed;
}

/**
 * Fire the seal step through the real mediator and native transport.
 * @param modulus - Value of `carry.modulus`.
 * @returns The step result.
 */
async function fireSeal(modulus: string): ReturnType<typeof runStep> {
  const bus = makeNativeMediator(HINT, ORIGIN);
  const scope = scopeWith(modulus);
  return runStep({ step: SEAL_STEP, bus, scope, companyId: HINT });
}

/**
 * A JSON seal step targeting a nested field.
 * @param shape - Body template.
 * @param writeTo - Destination pointer.
 * @returns Step config.
 */
function jsonSeal(shape: IBodyTemplate['shape'], writeTo: string): IPostStep {
  return {
    ...SEAL_STEP,
    encoding: 'json',
    body: { shape },
    seal: { ...SEAL_CONFIG, writeTo },
  };
}

describe('N10 sealed login fields', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('writes the sealed password at writeTo, keeping the field order', async () => {
    const fake = serveState();
    const result = await fireSeal(KEY.modulusHex);
    expect(result.success).toBe(true);
    const sent = sentForm(fake);
    const names = sent.keys();
    expect([...names]).toEqual(['identifier', 'credentials', 'authType']);
    const sealed = sent.get('credentials') ?? '';
    const opened = openSeal(sealed, KEY);
    expect(opened.source).toBe(PASSWORD);
    expect(opened.blocks[0]).toMatch(/^\[ENC\]/);
  });

  it('copies neither the password nor the sealed value into carry', async () => {
    const fake = serveState();
    const result = await fireSeal(KEY.modulusHex);
    if (!result.success) throw new TypeError(result.errorMessage);
    const sent = sentForm(fake);
    const sealed = sent.get('credentials') ?? '';
    expect(sealed).not.toBe('');
    const carried = JSON.stringify(result.value.carry);
    expect(carried).not.toContain(PASSWORD);
    expect(carried).not.toContain(sealed);
  });

  it.each(['carry reference', 'literal'] as const)(
    'leaves nested %s data unchanged while sealing the request',
    async source => {
      const auth = { credentials: '', other: 'keep' };
      const original = scopeWith(KEY.modulusHex);
      const scope = { ...original, carry: { ...original.carry, auth } };
      const node = source === 'literal' ? { $literal: auth } : { $ref: 'carry.auth' as const };
      const step = jsonSeal({ auth: node }, '/auth/credentials');
      const fake = serveState();
      const bus = makeNativeMediator(HINT, ORIGIN);
      const result = await runStep({ step, bus, scope, companyId: HINT });
      expect(result.success).toBe(true);
      expect(auth).toEqual({ credentials: '', other: 'keep' });
      const sent = sentJson(fake);
      const credentials: unknown = expect.stringMatching(/\S/u);
      expect(sent).toEqual({ auth: { credentials, other: 'keep' } });
    },
  );

  it('seals an existing array entry without dropping its siblings or mutating the literal', async () => {
    const items = [{ credentials: '', other: 'keep' }, { other: 'untouched' }];
    const step = jsonSeal({ items: { $literal: items } }, '/items/0/credentials');
    const fake = serveState();
    const bus = makeNativeMediator(HINT, ORIGIN);
    const scope = scopeWith(KEY.modulusHex);
    const result = await runStep({ step, bus, scope, companyId: HINT });
    expect(result.success).toBe(true);
    expect(items[0].credentials).toBe('');
    const sent = sentJson(fake);
    const credentials: unknown = expect.stringMatching(/\S/u);
    expect(sent).toEqual({
      items: [{ credentials, other: 'keep' }, { other: 'untouched' }],
    });
  });

  it('refuses a seal destination missing from the hydrated body before sending', async () => {
    const step = jsonSeal({ auth: { $literal: { other: 'keep' } } }, '/auth/credentials');
    const fake = serveState();
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({ step, bus, scope: scopeWith(KEY.modulusHex), companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'login seal writeTo invalid' });
    expect(fake.calls).toHaveLength(0);
  });

  it('fails "<step> seal key invalid" before any request for a bad modulus', async () => {
    const fake = serveState();
    const result = await fireSeal('abc');
    expect(result).toMatchObject({ success: false, errorMessage: 'login seal key invalid' });
    expect(fake.calls).toHaveLength(0);
  });

  it('fails before any request when the modulus slot is missing', async () => {
    const fake = serveState();
    const bus = makeNativeMediator(HINT, ORIGIN);
    const creds = { userCode: 'syn-user', password: PASSWORD };
    const scope = { carry: {}, creds, config: PLAIN_CONFIG, keypair: undefined };
    const result = await runStep({ step: SEAL_STEP, bus, scope, companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'login seal key invalid' });
    expect(fake.calls).toHaveLength(0);
  });
});

/**
 * Fire the PKCS#1 seal step with the given carry and creds.
 * @param carry - Step carry.
 * @param creds - Synthetic credentials.
 * @returns The step result.
 */
async function firePkcs1(
  carry: Record<string, string>,
  creds: Record<string, string>,
): ReturnType<typeof runStep> {
  const bus = makeNativeMediator(HINT, ORIGIN);
  const scope = { carry, creds, config: PLAIN_CONFIG, keypair: undefined };
  return runStep({ step: PKCS1_STEP, bus, scope, companyId: HINT });
}

/**
 * The JSON body the first request sent.
 * @param fake - The fetch fake.
 * @returns Its body fields.
 */
function sentJson(fake: IFetchFake): Record<string, string> {
  const body = fake.calls[0].init.body as string;
  return JSON.parse(body) as Record<string, string>;
}

const PKCS1_CREDS = { num: NUM, password: PASSWORD };
const KEY_MSG = 'logon seal key invalid';

/** One PKCS#1 seal that must fail before the request. */
interface IPkcs1Failure {
  readonly label: string;
  readonly carry: Record<string, string>;
  readonly creds: Record<string, string>;
  readonly message: string;
}

describe('N44 fields sealed with RSA PKCS#1 v1.5', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('writes each source sealed alone at its writeTo, keeping the field order', async () => {
    const fake = serveState();
    const result = await firePkcs1({ rsaKey: PKCS1_KEY.pem }, PKCS1_CREDS);
    expect(result.success).toBe(true);
    const sent = sentJson(fake);
    const names = Object.keys(sent);
    const openedNum = openPkcs1(PKCS1_KEY.privateKey, sent.ThirdIdentifier);
    const openedPassword = openPkcs1(PKCS1_KEY.privateKey, sent.Password);
    expect(names).toEqual(['Uid', 'ThirdIdentifier', 'Password']);
    expect(sent.Uid).toBe('syn-uid');
    expect(openedNum).toBe(NUM);
    expect(openedPassword).toBe(PASSWORD);
  });

  it('copies no source and no sealed value into carry', async () => {
    const fake = serveState();
    const result = await firePkcs1({ rsaKey: PKCS1_KEY.derBase64 }, PKCS1_CREDS);
    if (!result.success) throw new TypeError(result.errorMessage);
    const sent = sentJson(fake);
    const carried = JSON.stringify(result.value.carry);
    const secrets = [NUM, PASSWORD, sent.ThirdIdentifier, sent.Password];
    const leaked = secrets.filter((secret): boolean => carried.includes(secret));
    expect(leaked).toEqual([]);
  });

  it.each<IPkcs1Failure>([
    { label: 'the key slot is missing', carry: {}, creds: PKCS1_CREDS, message: KEY_MSG },
    {
      label: 'the key is not RSA',
      carry: { rsaKey: 'syn-not-a-key' },
      creds: PKCS1_CREDS,
      message: KEY_MSG,
    },
    {
      label: 'a source is missing',
      carry: { rsaKey: PKCS1_KEY.pem },
      creds: { num: NUM },
      message: 'logon seal source invalid',
    },
    {
      label: 'a source has no latin1 byte',
      carry: { rsaKey: PKCS1_KEY.pem },
      creds: { num: NUM, password: 'syn-סיסמה' },
      message: 'logon seal unencodable',
    },
  ])('fails before any request when $label', async ({ carry, creds, message }) => {
    const fake = serveState();
    const result = await firePkcs1(carry, creds);
    expect(result).toMatchObject({ success: false, errorMessage: message });
    expect(fake.calls).toHaveLength(0);
  });
});
