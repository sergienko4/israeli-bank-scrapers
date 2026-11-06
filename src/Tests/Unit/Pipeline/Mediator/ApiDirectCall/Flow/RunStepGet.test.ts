/**
 * E8 — a login step may be a GET with no body.
 *
 * The stub cases prove the method map picks `apiGet` and hands it the query
 * and the Set-Cookie sink. The end-to-end cases drive the real mediator over
 * the headless native transport and read what reached `fetch`: a GET carries
 * no body and no content-type, a POST still sends JSON.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { createApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IBodyTemplate,
  IGetStep,
  IPostStep,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  createSimpleCookieJar,
  runStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { GraphQLFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch, type IFetchCall, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';
import { type IApiGetCapture, type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const SESSION_COOKIE = 'sid=syn-sid; Path=/; HttpOnly';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const GET_STEP: IGetStep = {
  name: 'bind',
  urlTag: 'auth.bind',
  method: 'GET',
  queryTemplate: { lang: { $literal: 'he' } },
  cookieJar: true,
  extractsToCarry: { token: '/access_token' },
};

const PORTAL_HTML = '<!doctype html><html><body><main id="portal-ready"></main></body></html>';

const DOCUMENT_STEP: IGetStep = {
  name: 'bind',
  urlTag: 'auth.bind',
  method: 'GET',
  response: 'document',
  documentMarker: 'portal-ready',
  extractsToCarry: {},
};

const POST_STEP: IPostStep = {
  name: 'login',
  urlTag: 'auth.login',
  body: { shape: { user: { $literal: 'syn-user' } } },
  extractsToCarry: { token: '/access_token' },
};

/** A GET step that also carries a body — the step union must reject it. */
type GetWithBody = Omit<IGetStep, 'body'> & { readonly body: IBodyTemplate };

/** A step literal written before E8: a body and no `method`. */
type PostWithoutMethod = Omit<IPostStep, 'method'>;

/** Compile-time pin: no step type admits a GET with a body. */
const isGetWithBodyAStep: [GetWithBody] extends [IStepConfig] ? true : false = false;

/** Compile-time pin: a step without `method` still type-checks as a POST. */
const isMethodlessPostAStep: [PostWithoutMethod] extends [IStepConfig] ? true : false = true;

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/api/bind`);
  registerWkUrl('auth.login', HINT, `${ORIGIN}/api/login`);
});

/**
 * Build an empty template scope.
 * @returns Template scope.
 */
function makeScope(): ITemplateScope {
  return { carry: {}, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
}

/**
 * Point globalThis.fetch at a fake that sets a cookie and returns a token.
 * @returns The fake, for request assertions.
 */
function installFetch(): IFetchFake {
  const fake = fakeFetch((): Response => {
    const headers = new Headers([['set-cookie', SESSION_COOKIE]]);
    return Response.json({ access_token: 'syn-token' }, { headers });
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * Point globalThis.fetch at a fake that answers every request with a 302.
 * @returns The fake, for request assertions.
 */
function installRedirect(): IFetchFake {
  const fake = fakeFetch((): Response => {
    const headers = new Headers([['location', `${ORIGIN}/elsewhere`]]);
    return new Response(null, { status: 302, headers });
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * Point globalThis.fetch at a fake that serves one HTML page.
 * @param html - Page body.
 * @returns The fake, for request assertions.
 */
function installPage(html: string | Uint8Array<ArrayBuffer>): IFetchFake {
  const fake = fakeFetch((): Response => new Response(html, { status: 200 }));
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
 * The single request the fake saw.
 * @param fake - Fetch fake.
 * @returns Its only call.
 */
function onlyCall(fake: IFetchFake): IFetchCall {
  expect(fake.calls).toHaveLength(1);
  return fake.calls[0];
}

/**
 * Read the request headers case-insensitively.
 * @param call - Recorded fetch call.
 * @returns Header view of the request.
 */
function sentHeaders(call: IFetchCall): Headers {
  return new Headers(call.init.headers);
}

describe('E8 GET login step on a stub bus', () => {
  it('sends a GET step through apiGet with its query and cookie sink', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const getCaptures: IApiGetCapture[] = [];
    const responses = [succeed({ access_token: 'syn-token' })];
    const bus = makeStubMediator({ responses, captures, getCaptures });
    const cookieJar = createSimpleCookieJar();
    const args = { step: GET_STEP, bus, scope: makeScope(), companyId: HINT, cookieJar };
    const result = await runStep(args);
    expect(captures).toEqual([]);
    expect(getCaptures).toEqual([
      { url: 'auth.bind', extraHeaders: {}, query: { lang: 'he' }, hasCookieSink: true },
    ]);
    expect(result).toMatchObject({ success: true, value: { carry: { token: 'syn-token' } } });
  });

  it('rejects a GET step with a body at compile time', (): void => {
    expect(isGetWithBodyAStep).toBe(false);
  });

  it('accepts a step without a method as a POST at compile time', (): void => {
    expect(isMethodlessPostAStep).toBe(true);
  });
});

describe('E8 GET login step over the headless native transport', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('sends no body and no content-type, then keeps the cookie', async (): Promise<void> => {
    const fake = installFetch();
    const bus = makeNativeMediator();
    const cookieJar = createSimpleCookieJar();
    const args = { step: GET_STEP, bus, scope: makeScope(), companyId: HINT, cookieJar };
    const result = await runStep(args);
    const call = onlyCall(fake);
    const hasContentType = sentHeaders(call).has('content-type');
    const jarHeader = cookieJar.header();
    expect(call.url).toBe(`${ORIGIN}/api/bind?lang=he`);
    expect(call.init).toMatchObject({ method: 'GET' });
    expect(call.init.body).toBeUndefined();
    expect(hasContentType).toBe(false);
    expect(jarHeader).toBe('sid=syn-sid');
    expect(result).toMatchObject({ success: true, value: { carry: { token: 'syn-token' } } });
  });

  it("refuses a redirect under the step's own policy", async (): Promise<void> => {
    const fake = installRedirect();
    const step: IGetStep = { ...GET_STEP, redirect: 'reject' };
    const bus = makeNativeMediator();
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    const call = onlyCall(fake);
    expect(call.init).toMatchObject({ redirect: 'manual' });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'bind HTTP 302 redirect refused',
    });
  });

  it('reads a document step without parsing it', async (): Promise<void> => {
    installPage(PORTAL_HTML);
    const bus = makeNativeMediator();
    const result = await runStep({ step: DOCUMENT_STEP, bus, scope: makeScope(), companyId: HINT });
    expect(result).toMatchObject({ success: true, value: { carry: {} } });
  });

  it('refuses a document step whose marker is missing', async (): Promise<void> => {
    installPage('<html><body>maintenance</body></html>');
    const bus = makeNativeMediator();
    const result = await runStep({ step: DOCUMENT_STEP, bus, scope: makeScope(), companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'bind document unverified' });
  });

  it("refuses a document of another media type than the step's", async (): Promise<void> => {
    installPage(PORTAL_HTML);
    const step: IGetStep = { ...DOCUMENT_STEP, mediaType: 'text/html' };
    const bus = makeNativeMediator();
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'bind unexpected media type' });
  });

  it('refuses a document that is not UTF-8 on a strict step', async (): Promise<void> => {
    const marker = new TextEncoder().encode('portal-ready');
    const page = Uint8Array.of(...marker, 0xff);
    installPage(page);
    const step: IGetStep = { ...DOCUMENT_STEP, strictUtf8: true };
    const bus = makeNativeMediator();
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'bind body not utf-8' });
  });

  it('leaves redirects to fetch when the step names no policy', async (): Promise<void> => {
    const fake = installFetch();
    const bus = makeNativeMediator();
    await runStep({ step: POST_STEP, bus, scope: makeScope(), companyId: HINT });
    const call = onlyCall(fake);
    expect(call.init).not.toHaveProperty('redirect');
  });

  it('still sends a POST step as JSON', async (): Promise<void> => {
    const fake = installFetch();
    const bus = makeNativeMediator();
    const result = await runStep({ step: POST_STEP, bus, scope: makeScope(), companyId: HINT });
    const call = onlyCall(fake);
    const contentType = sentHeaders(call).get('content-type');
    expect(call.init).toMatchObject({ method: 'POST', body: '{"user":"syn-user"}' });
    expect(contentType).toBe('application/json');
    expect(result).toMatchObject({ success: true, value: { carry: { token: 'syn-token' } } });
  });

  it('sends one content-type when a step sets Content-Type', async (): Promise<void> => {
    const fake = installFetch();
    const bus = makeNativeMediator();
    const headers = { 'Content-Type': { $literal: 'application/json; charset=UTF-8' } };
    const step: IPostStep = { ...POST_STEP, headers };
    await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    const call = onlyCall(fake);
    const contentType = sentHeaders(call).get('content-type');
    expect(contentType).toBe('application/json; charset=UTF-8');
  });
});
