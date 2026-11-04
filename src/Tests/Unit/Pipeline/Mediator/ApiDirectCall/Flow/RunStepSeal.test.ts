/**
 * N10 — a step naming `seal` seals a credential into its body at `writeTo`
 * before the request: the source comes from creds, the hex modulus from
 * carry, and neither the plaintext nor the sealed value enters carry.
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
import { makeSealKey, openSeal, SEAL_PARAMS } from '../../../../../Helpers/SealOpener.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const KEY = makeSealKey();
const PASSWORD = 'syn-Pass!7 é';

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
