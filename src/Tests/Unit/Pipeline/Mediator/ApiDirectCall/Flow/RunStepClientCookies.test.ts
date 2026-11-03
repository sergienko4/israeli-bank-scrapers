/**
 * A step's `setCookies` writes client cookies into the run's domain
 * jar before its request, so they travel on that request and the next; a
 * `cookie.<name>` ref reads a jar cookie, URL-decoded, for the step URL.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { createHeadlessApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IPostStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://bank.example';
const SEAL_COOKIE = '3ba782e1967c24a2c0ffee3ba782e1';
const CSRF_LINE = 'csrfcookie=a%2Fb%3D; Path=/';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const INIT_STEP: IPostStep = {
  name: 'bind',
  urlTag: 'auth.bind',
  body: { shape: { start: { $literal: true } } },
  setCookies: { G3CmE: 'carry.g3' },
  extractsToCarry: {},
};

const LOGIN_STEP: IPostStep = {
  name: 'login',
  urlTag: 'auth.login',
  encoding: 'form',
  body: { shape: { csrffield: { $ref: 'cookie.csrfcookie' } } },
  extractsToCarry: {},
};

const PLAIN_LOGIN: IPostStep = { ...LOGIN_STEP, body: { shape: { a: { $literal: 'b' } } } };

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/authenticate/init`);
  registerWkUrl('auth.login', HINT, `${ORIGIN}/authenticate/verify`);
});

/**
 * A native mediator whose run keeps a domain cookie jar.
 * @returns The bus.
 */
function jarBus(): ITokenBus {
  return createHeadlessApiMediator({
    bankHint: HINT,
    identityBaseUrl: `${ORIGIN}/`,
    graphqlUrl: `${ORIGIN}/graphql`,
    sessionCookies: true,
    cookieDomains: ['bank.example'],
  });
}

/**
 * Template scope holding the seal cookie's carry slot.
 * @param g3 - Value of `carry.g3`.
 * @returns Template scope.
 */
function scopeWith(g3: JsonValue): ITemplateScope {
  return { carry: { g3 }, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
}

/**
 * Answer every call with `{}`, setting the CSRF cookie on the init call.
 * @returns The fake, for request assertions.
 */
function serveBank(): IFetchFake {
  const fake = fakeFetch((url): Response => {
    const isInit = url.endsWith('/authenticate/init');
    const headers: [string, string][] = isInit ? [['set-cookie', CSRF_LINE]] : [];
    return Response.json({}, { headers });
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * The Cookie header one call sent.
 * @param fake - The fetch fake.
 * @param index - Zero-based call index.
 * @returns The header, or an empty string.
 */
function cookieSent(fake: IFetchFake, index: number): string {
  const headers = fake.calls[index].init.headers as Partial<Record<string, string>>;
  return headers.cookie ?? '';
}

/**
 * Run init, then a step, on one bus.
 * @param bus - Token bus.
 * @param next - The step after init.
 * @returns The second step's result.
 */
async function initThen(bus: ITokenBus, next: IPostStep): ReturnType<typeof runStep> {
  const scope = scopeWith(SEAL_COOKIE);
  const first = await runStep({ step: INIT_STEP, bus, scope, companyId: HINT });
  if (!first.success) return first;
  return runStep({ step: next, bus, scope: first.value, companyId: HINT });
}

describe('client cookies', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('sends the set cookie on its own request and the next', async () => {
    const fake = serveBank();
    const bus = jarBus();
    const result = await initThen(bus, PLAIN_LOGIN);
    expect(result.success).toBe(true);
    const onInit = cookieSent(fake, 0);
    const onLogin = cookieSent(fake, 1);
    expect(onInit).toContain(`G3CmE=${SEAL_COOKIE}`);
    expect(onLogin).toContain(`G3CmE=${SEAL_COOKIE}`);
  });

  it.each([
    ['a separator', 'a;b'],
    ['a space', 'a b'],
    ['a number', 7],
    ['an empty value', ''],
    ['an oversized value', 'x'.repeat(4097)],
  ])('fails "<step> setCookies <name> invalid" for %s before any request', async (_l, g3) => {
    const fake = serveBank();
    const scope = scopeWith(g3);
    const result = await runStep({ step: INIT_STEP, bus: jarBus(), scope, companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'bind setCookies G3CmE invalid' });
    expect(fake.calls).toHaveLength(0);
  });

  it('fails "<step> setCookies needs a cookie session" without a domain jar', async () => {
    const fake = serveBank();
    const bus = makeNativeMediator(HINT, ORIGIN);
    const scope = scopeWith(SEAL_COOKIE);
    const result = await runStep({ step: INIT_STEP, bus, scope, companyId: HINT });
    const message = 'bind setCookies needs a cookie session';
    expect(result).toMatchObject({ success: false, errorMessage: message });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('cookie refs', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('writes a response cookie, URL-decoded, into a form field', async () => {
    const fake = serveBank();
    const bus = jarBus();
    const result = await initThen(bus, LOGIN_STEP);
    expect(result.success).toBe(true);
    const body = fake.calls[1].init.body as string;
    const sent = new URLSearchParams(body);
    const field = sent.get('csrffield');
    expect(field).toBe('a/b=');
  });

  it('fails "ref cookie.<name> miss" before the request when the jar lacks it', async () => {
    const fake = serveBank();
    const scope = scopeWith(SEAL_COOKIE);
    const result = await runStep({ step: LOGIN_STEP, bus: jarBus(), scope, companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'ref cookie.csrfcookie miss' });
    expect(fake.calls).toHaveLength(0);
  });
});
