/**
 * N41 — a step's raw query. The joined text goes after the step URL's `?`
 * verbatim, never re-encoded; a text outside printable ASCII, holding a
 * banned character, empty or over 32 768 chars fails before anything is sent.
 * The cases drive the real mediator over the headless native transport and
 * read the URL that reached `fetch`.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { createApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  IJoinTemplate,
  IPostStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { GraphQLFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';

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

const CODE_QUERY: IJoinTemplate = { prefix: 'code=', parts: ['carry.ssoCode'] };

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
  const transport = new HeadlessNativeFetchStrategy(ORIGIN);
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

describe('N41 raw query', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
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
