/**
 * A step naming `seal` seals credentials into its body before
 * the request: each source comes from creds, the key from carry, and neither
 * the plaintext nor the sealed value enters carry. A block-xor seal writes
 * one field; an `rsa-pkcs1-v15` seal writes one field per source.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type {
  IApiDirectCallConfig,
  IBodyTemplate,
  IPostStep,
  ISealRsaBlockXorConfig,
  ISealRsaPkcs1Config,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
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

const SEAL_CONFIG: ISealRsaBlockXorConfig = {
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

const PKCS1_SEAL: ISealRsaPkcs1Config = {
  kind: 'rsa-pkcs1-v15',
  keyRef: 'carry.rsaKey',
  fields: [
    { sourceRef: 'creds.num', writeTo: '/ThirdIdentifier' },
    { sourceRef: 'creds.password', writeTo: '/Password' },
  ],
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
  seal: PKCS1_SEAL,
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

describe('sealed login fields', () => {
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
 * @param step - Step config, defaulting to the plain PKCS#1 fixture.
 * @returns The step result.
 */
async function firePkcs1(
  carry: ITemplateScope['carry'],
  creds: Record<string, string>,
  step: IPostStep = PKCS1_STEP,
): ReturnType<typeof runStep> {
  const bus = makeNativeMediator(HINT, ORIGIN);
  const scope = { carry, creds, config: PLAIN_CONFIG, keypair: undefined };
  return runStep({ step, bus, scope, companyId: HINT });
}

/**
 * The JSON body the first request sent.
 * @param fake - The fetch fake.
 * @returns Its body fields.
 */
function sentPkcs1Fields(fake: IFetchFake): Record<string, string> {
  return sentJson(fake) as Record<string, string>;
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

/** A supported body shape that shares its credential placeholders. */
interface IAliasedBody {
  readonly label: string;
  readonly makeShape: (shared: Record<string, string>) => IBodyTemplate['shape'];
}

/** Both write orders for one aliased body shape. */
interface IAliasedSealCase extends IAliasedBody {
  readonly isReversed: boolean;
}

/** A custom-prototype record whose two fields share one placeholder object. */
class SharedLiteral {
  public readonly a: Record<string, string>;
  public readonly b: Record<string, string>;

  /**
   * Alias both fields to one placeholder.
   * @param value - Shared placeholder object.
   */
  constructor(value: Record<string, string>) {
    this.a = value;
    this.b = value;
  }
}

const ALIASED_BODIES: readonly IAliasedBody[] = [
  {
    label: 'repeated refs',
    /**
     * Reference the same carried object from both branches.
     * @returns Aliased reference template.
     */
    makeShape: (): IBodyTemplate['shape'] => ({
      a: { $ref: 'carry.shared' },
      b: { $ref: 'carry.shared' },
    }),
  },
  {
    label: 'shared literals',
    /**
     * Place one literal object in both branches.
     * @param shared - Credential placeholder.
     * @returns Aliased literal template.
     */
    makeShape: (shared): IBodyTemplate['shape'] => ({
      a: { $literal: shared },
      b: { $literal: shared },
    }),
  },
  {
    label: 'a nested literal',
    /**
     * Keep nested aliases inside one literal node.
     * @param shared - Credential placeholder.
     * @returns Nested aliased literal template.
     */
    makeShape: (shared): IBodyTemplate['shape'] => ({ $literal: { a: shared, b: shared } }),
  },
  {
    label: 'a custom-prototype literal',
    /**
     * Keep aliases through a prototype the structured clone discards.
     * @param shared - Credential placeholder.
     * @returns Custom-prototype literal template.
     */
    makeShape: (shared): IBodyTemplate['shape'] => ({ $literal: new SharedLiteral(shared) }),
  },
];

const ALIAS_CASES = ALIASED_BODIES.flatMap((body): readonly IAliasedSealCase[] => [
  { ...body, isReversed: false },
  { ...body, isReversed: true },
]);

/**
 * Seal two sources into separate paths of an aliased body.
 * @param shape - Aliased body template.
 * @param isReversed - Whether to reverse the planned writes.
 * @returns Step config.
 */
function aliasedStep(shape: IBodyTemplate['shape'], isReversed: boolean): IPostStep {
  const [num, password] = PKCS1_SEAL.fields;
  const fields = [
    { ...num, writeTo: '/a/value' },
    { ...password, writeTo: '/b/value' },
  ];
  const ordered = isReversed ? fields.reverse() : fields;
  const seal = { ...PKCS1_SEAL, fields: ordered };
  return { ...PKCS1_STEP, body: { shape }, seal };
}

/**
 * Open both nested credential fields from the actual outbound body.
 * @param fake - Fetch fake.
 * @returns Original source text for each destination.
 */
function openedAliasFields(fake: IFetchFake): readonly string[] {
  const sent = sentJson(fake) as Record<string, Record<string, string>>;
  const num = openPkcs1(PKCS1_KEY.privateKey, sent.a.value);
  const password = openPkcs1(PKCS1_KEY.privateKey, sent.b.value);
  return [num, password];
}

describe('fields sealed with RSA PKCS#1 v1.5', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('writes each source sealed alone at its writeTo, keeping the field order', async () => {
    const fake = serveState();
    const result = await firePkcs1({ rsaKey: PKCS1_KEY.pem }, PKCS1_CREDS);
    expect(result.success).toBe(true);
    const sent = sentPkcs1Fields(fake);
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
    const sent = sentPkcs1Fields(fake);
    const carried = JSON.stringify(result.value.carry);
    const secrets = [NUM, PASSWORD, sent.ThirdIdentifier, sent.Password];
    const leaked = secrets.filter((secret): boolean => carried.includes(secret));
    expect(leaked).toEqual([]);
  });

  it.each(ALIAS_CASES)(
    'keeps $label independent when reversed=$isReversed',
    async ({ makeShape, isReversed }) => {
      const shared = { value: '' };
      const shape = makeShape(shared);
      const step = aliasedStep(shape, isReversed);
      const fake = serveState();
      const result = await firePkcs1({ rsaKey: PKCS1_KEY.pem, shared }, PKCS1_CREDS, step);
      if (!result.success) throw new TypeError(result.errorMessage);
      const opened = openedAliasFields(fake);
      expect(opened).toEqual([NUM, PASSWORD]);
      expect(shared).toEqual({ value: '' });
    },
  );

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
    {
      label: 'an empty first source precedes an unencodable later source',
      carry: { rsaKey: PKCS1_KEY.pem },
      creds: { num: '', password: 'syn-סיסמה' },
      message: 'logon seal source invalid',
    },
  ])('fails before any request when $label', async ({ carry, creds, message }) => {
    const fake = serveState();
    const result = await firePkcs1(carry, creds);
    expect(result).toMatchObject({ success: false, errorMessage: message });
    expect(fake.calls).toHaveLength(0);
  });
});
