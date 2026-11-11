/**
 * A step's raw query. The joined text goes after the step URL's `?`
 * verbatim, never re-encoded; a text outside printable ASCII, holding a
 * banned character, empty or over 32 768 chars fails before anything is sent.
 * The cases drive the real mediator over the headless native transport and
 * read the URL and signature that reached `fetch`.
 */

import { verify } from 'node:crypto';

import { CompanyTypes } from '../../../../../../Definitions.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import { createApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  IJoinTemplate,
  IPostStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IGenericKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { generateKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { GraphQLFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { cappedNative } from '../../../../../Helpers/CappedTransport.js';
import { fakeFetch, type IFetchCall, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const RAW_INVALID = 'sessionToken raw query invalid';

/** Every printable-ASCII sign the raw query keeps as-is. */
const SSO_CODE = 'a%2Bb+c/=?:@!$&()*,;[]{}|^`~-._x';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const SIGNED_CONFIG: IApiDirectCallConfig = {
  ...PLAIN_CONFIG,
  signer: {
    algorithm: 'ECDSA-P256',
    encoding: 'DER',
    headerName: 'X-Sig',
    schemeTag: 4,
    canonical: {
      parts: ['pathAndQuery'],
      separator: '%%',
      escapeFrom: '%%',
      escapeTo: String.raw`\%`,
      sortQueryParams: false,
      clientVersion: '1.2.3',
    },
  },
};

const CODE_QUERY: IJoinTemplate = { prefix: 'code=', parts: ['carry.ssoCode'] };
const UUID_QUERY: IJoinTemplate = { parts: ['uuid'] };

const GET_STEP: IGetStep = {
  name: 'sessionToken',
  urlTag: 'auth.bind',
  method: 'GET',
  rawQuery: CODE_QUERY,
  extractsToCarry: { token: '/access_token' },
};

const POST_STEP: IPostStep = {
  name: 'sessionToken',
  urlTag: 'auth.login',
  rawQuery: { parts: [{ literal: 'v=1' }] },
  body: { shape: { user: { $literal: 'syn-user' } } },
  extractsToCarry: { token: '/access_token' },
};

const QUERIED_STEP: IGetStep = { ...GET_STEP, urlTag: 'auth.verify' };

const BARE_STEP: IGetStep = { ...GET_STEP, rawQuery: { parts: ['carry.ssoCode'] } };

const UUID_STEPS = [
  ['GET', { ...GET_STEP, rawQuery: UUID_QUERY } satisfies IGetStep],
  ['POST', { ...POST_STEP, rawQuery: UUID_QUERY } satisfies IPostStep],
] as const;

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/api/bind`);
  registerWkUrl('auth.login', HINT, `${ORIGIN}/api/login`);
  registerWkUrl('auth.verify', HINT, `${ORIGIN}/api/verify?aid=syn`);
});

/**
 * A template scope whose carry holds the given SSO code.
 * @param ssoCode - Carried code.
 * @returns Template scope.
 */
function scopeWith(ssoCode: string): ITemplateScope {
  return { carry: { ssoCode }, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
}

/**
 * Point globalThis.fetch at a fake that returns a token.
 * @returns The fake, for request assertions.
 */
function installFetch(): IFetchFake {
  const fake = fakeFetch((): Response => Response.json({ access_token: 'syn-token' }));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * Real mediator over the real headless native transport.
 * @returns Mediator bound to the fake fetch.
 */
function makeNativeMediator(): ITokenBus {
  const graphql = {} as unknown as GraphQLFetchStrategy;
  const transport = cappedNative(ORIGIN);
  return createApiMediator(HINT, transport, graphql);
}

/**
 * Run one step over the native mediator.
 * @param step - Step under test.
 * @param ssoCode - Carried code.
 * @returns The fetch fake and the step result.
 */
async function runOver(step: IGetStep | IPostStep, ssoCode: string): Promise<IRunOutcome> {
  const fake = installFetch();
  const bus = makeNativeMediator();
  const scope = scopeWith(ssoCode);
  const result = await runStep({ step, bus, scope, companyId: HINT });
  return { fake, result };
}

/** What one run sent and returned. */
interface IRunOutcome {
  readonly fake: IFetchFake;
  readonly result: Awaited<ReturnType<typeof runStep>>;
}

/**
 * Verify a dispatched signature against the URL actually received by fetch.
 * @param call - Captured request.
 * @param keypair - Public key of the signer.
 * @param pathAndQuery - Candidate canonical bytes.
 * @returns True only when the header signs those bytes with that key.
 */
function verifiesUrl(call: IFetchCall, keypair: IGenericKeypair, pathAndQuery: string): boolean {
  const header = new Headers(call.init.headers).get('X-Sig') ?? '';
  const parts = /^data:([^;]+);key-id:([a-f0-9]+);scheme:4$/u.exec(header);
  if (parts === null) return false;
  if (parts[2] !== keypair.keyIdHex) return false;
  const publicKey = { key: keypair.publicKeyDer, format: 'der', type: 'spki' } as const;
  const signature = Buffer.from(parts[1], 'base64');
  const bytes = Buffer.from(pathAndQuery);
  return verify('sha256', bytes, publicKey, signature);
}

describe('raw query', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it.each(UUID_STEPS)('signs the %s request with the UUID sent to fetch', async (_label, step) => {
    const keypair = generateKeypair('ECDSA-P256');
    if (!keypair.success) throw new ScraperError('P-256 keypair generation should succeed');
    const fake = installFetch();
    const bus = makeNativeMediator();
    const scope = { ...scopeWith('x'), config: SIGNED_CONFIG };
    const result = await runStep({
      step,
      bus,
      scope,
      companyId: HINT,
      signingKeypair: keypair.value,
    });
    expect(result).toMatchObject({ success: true });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    const url = new URL(call.url);
    const uuid = url.search.slice(1);
    const signedPath = `${url.pathname}${url.search}`;
    const isSigned = verifiesUrl(call, keypair.value, signedPath);
    const isChangedUrlSigned = verifiesUrl(call, keypair.value, `${url.pathname}?changed`);
    expect(uuid).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
    expect(isSigned).toBe(true);
    expect(isChangedUrlSigned).toBe(false);
  });

  it('appends the joined text after ? verbatim', async (): Promise<void> => {
    const { fake, result } = await runOver(GET_STEP, SSO_CODE);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(`${ORIGIN}/api/bind?code=${SSO_CODE}`);
    expect(result).toMatchObject({ success: true, value: { carry: { token: 'syn-token' } } });
  });

  it('appends to a POST step too', async (): Promise<void> => {
    const { fake, result } = await runOver(POST_STEP, SSO_CODE);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(`${ORIGIN}/api/login?v=1`);
    expect(result).toMatchObject({ success: true });
  });

  it('follows a query the step URL already has with &', async (): Promise<void> => {
    const { fake } = await runOver(QUERIED_STEP, 'x');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(`${ORIGIN}/api/verify?aid=syn&code=x`);
  });

  it('accepts a text of exactly 32 768 chars', async (): Promise<void> => {
    const longest = 'a'.repeat(32_768);
    const { fake, result } = await runOver(BARE_STEP, longest);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(`${ORIGIN}/api/bind?${longest}`);
    expect(result).toMatchObject({ success: true });
  });

  it.each([
    ['a space', 'a b'],
    ['a hash', 'a#b'],
    ['a double quote', 'a"b'],
    ['an apostrophe', "a'b"],
    ['a less-than sign', 'a<b'],
    ['a greater-than sign', 'a>b'],
    ['a backslash', 'a\\b'],
    ['a tab', 'a\tb'],
    ['a DEL', 'a\u007Fb'],
    ['a non-ASCII letter', 'a\u00E9b'],
    ['an empty text', ''],
    ['32 769 chars', 'a'.repeat(32_769)],
  ])('refuses %s before sending', async (_label: string, raw: string): Promise<void> => {
    const { fake, result } = await runOver(BARE_STEP, raw);
    expect(fake.calls).toHaveLength(0);
    expect(result).toMatchObject({ success: false, errorMessage: RAW_INVALID });
  });

  it('fails on an unresolved part before sending', async (): Promise<void> => {
    const step: IGetStep = { ...GET_STEP, rawQuery: { parts: ['carry.missing'] } };
    const { fake, result } = await runOver(step, 'x');
    expect(fake.calls).toHaveLength(0);
    expect(result).toMatchObject({ success: false });
  });
});
