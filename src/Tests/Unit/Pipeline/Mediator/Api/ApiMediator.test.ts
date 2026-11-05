/**
 * ApiMediator — unit tests for the Black Box headless transport mediator.
 * Covers WK URL/query resolution, Bearer injection, GraphQL envelope unwrap,
 * and the reuse-contract regex guard (no bank names leak into the file).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  HMAC_KEY_SLOT,
  HMAC_SIGNER_SLOT,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.hmacHeaders.js';
import {
  createApiMediator,
  createBrowserBackedHeadlessApiMediator,
  createHeadlessApiMediator,
  type IApiMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  registerWkQuery,
  WK_QUERIES,
} from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import { registerWkUrl, WK_URLS } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type {
  IFetchOpts,
  IFetchStrategy,
  PostData,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { GraphQLFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import type { INativeFetchOptions } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js';
import type { IApiQueryOpts } from '../../../../../Scrapers/Pipeline/Types/Domain/ApiQueryOpts.js';
import type { IResponseHeaderSink } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Capture of a single outbound fetchPost call. */
interface IPostCall {
  readonly url: string;
  readonly body: PostData;
  readonly opts: IFetchOpts;
}

/** Capture of a single outbound fetchGet call. */
interface IGetCall {
  readonly url: string;
  readonly opts: IFetchOpts;
}

/** Capture of a single outbound graphql query call. */
interface IQueryCall {
  readonly query: string;
  readonly variables: Record<string, unknown>;
  readonly opts: IFetchOpts;
}

/** Captured outbound traffic + configurable responses. */
interface IRecorder {
  readonly postCalls: IPostCall[];
  readonly getCalls: IGetCall[];
  readonly queryCalls: IQueryCall[];
  postResult: Procedure<unknown>;
  getResult: Procedure<unknown>;
  queryResult: Procedure<unknown>;
}

/**
 * Build a fresh recorder with default success responses.
 * @returns Recorder.
 */
function makeRecorder(): IRecorder {
  return {
    postCalls: [],
    getCalls: [],
    queryCalls: [],
    postResult: succeed({}),
    getResult: succeed({}),
    queryResult: succeed({}),
  };
}

/**
 * Build a fake fetch strategy that records calls.
 * @param recorder - Shared capture + response cfg.
 * @returns IFetchStrategy fake.
 */
function makeFetchStrategy(recorder: IRecorder): IFetchStrategy {
  return {
    /**
     * Recording fetchPost.
     * @param url - Target URL.
     * @param body - Post body.
     * @param opts - Fetch opts.
     * @returns Recorded response.
     */
    fetchPost: async <T>(url: string, body: PostData, opts: IFetchOpts): Promise<Procedure<T>> => {
      recorder.postCalls.push({ url, body, opts });
      await Promise.resolve();
      return recorder.postResult as Procedure<T>;
    },
    /**
     * Recording fetchGet.
     * @param url - Target URL.
     * @param opts - Fetch opts.
     * @returns Recorded response.
     */
    fetchGet: async <T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> => {
      recorder.getCalls.push({ url, opts });
      await Promise.resolve();
      return recorder.getResult as Procedure<T>;
    },
  };
}

/** Fake GraphQLFetchStrategy subclass for capturing query calls. */
class FakeGraphQLStrategy extends GraphQLFetchStrategy {
  private readonly _recorder: IRecorder;

  /**
   * Create a FakeGraphQLStrategy.
   * @param recorder - Shared capture object.
   */
  constructor(recorder: IRecorder) {
    super('https://gql.example');
    this._recorder = recorder;
  }

  /**
   * Recording GraphQL query.
   * @param query - Query string.
   * @param variables - Query variables.
   * @param opts - Fetch opts.
   * @returns Recorded response.
   */
  public query<T>(
    query: string,
    variables: Record<string, unknown>,
    opts: IFetchOpts,
  ): Promise<Procedure<T>> {
    this._recorder.queryCalls.push({ query, variables, opts });
    return Promise.resolve(this._recorder.queryResult as Procedure<T>);
  }
}

/** The bank hint used for ApiMediator tests. */
const HINT = CompanyTypes.OneZero;

/**
 * Wipe registered WK queries + URLs before each test.
 * @returns True once cleared.
 */
function resetRegistries(): boolean {
  WK_QUERIES.clear();
  WK_URLS.clear();
  return true;
}

/**
 * Build an ApiMediator wired to a recorder.
 * @param recorder - Capture object.
 * @returns Mediator + graphql strategy reference.
 */
function buildMediator(recorder: IRecorder): IApiMediator {
  const fetchStrategy = makeFetchStrategy(recorder);
  const graphqlStrategy = new FakeGraphQLStrategy(recorder);
  return createApiMediator(HINT, fetchStrategy, graphqlStrategy);
}

/**
 * Set-Cookie hook stub that keeps nothing.
 * @returns Zero kept cookies.
 */
function keepNoCookies(): number {
  return 0;
}

beforeEach(() => {
  resetRegistries();
});

describe('ApiMediator/apiPost', () => {
  it('resolves URL via WK and fires fetchPost with no auth header when bearer unset', async () => {
    registerWkUrl('identity.deviceToken', HINT, 'https://id.example/devices/token');
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    const result = await mediator.apiPost('identity.deviceToken', { foo: 'bar' });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    expect(recorder.postCalls.length).toBe(1);
    const call = recorder.postCalls[0];
    expect(call.url).toBe('https://id.example/devices/token');
    expect(call.opts.extraHeaders).toEqual({});
  });

  it('unknown WK URL group returns a failure procedure', async () => {
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    const result = await mediator.apiPost('identity.deviceToken', { foo: 'bar' });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    expect(recorder.postCalls.length).toBe(0);
  });

  it('setBearer causes subsequent apiPost to include Authorization header', async () => {
    registerWkUrl('identity.deviceToken', HINT, 'https://id.example/devices/token');
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    const didStore = mediator.setBearer('tok-123');
    expect(didStore).toBe(true);
    await mediator.apiPost('identity.deviceToken', { ping: 'pong' });
    const call = recorder.postCalls[0];
    expect(call.opts.extraHeaders.authorization).toBe('Bearer tok-123');
  });

  it('without setBearer outbound headers have no authorization key', async () => {
    registerWkUrl('identity.deviceToken', HINT, 'https://id.example/devices/token');
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    await mediator.apiPost('identity.deviceToken', {});
    const call = recorder.postCalls[0];
    const keys = Object.keys(call.opts.extraHeaders);
    expect(keys).not.toContain('authorization');
  });
});

describe('ApiMediator/apiGet', () => {
  it('resolves URL via WK and fires fetchGet', async () => {
    registerWkUrl('graphql', HINT, 'https://gql.example/query');
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    const result = await mediator.apiGet('graphql');
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    expect(recorder.getCalls.length).toBe(1);
    expect(recorder.getCalls[0].url).toBe('https://gql.example/query');
  });

  it('unknown URL group returns failure', async () => {
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    const result = await mediator.apiGet('graphql');
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    expect(recorder.getCalls.length).toBe(0);
  });

  it('threads opts query, extra headers and the Set-Cookie hook to fetchGet', async () => {
    registerWkUrl('graphql', HINT, 'https://gql.example/query');
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    mediator.setRawAuth('Bearer t');
    const onSetCookie = keepNoCookies;
    const opts = { query: { from: '2026-01' }, extraHeaders: { cid: 'c-1' }, onSetCookie };
    await mediator.apiGet('graphql', opts);
    const [call] = recorder.getCalls;
    expect(call.url).toBe('https://gql.example/query?from=2026-01');
    expect(call.opts.extraHeaders).toEqual({ cid: 'c-1', authorization: 'Bearer t' });
    expect(call.opts.onSetCookie).toBe(onSetCookie);
  });

  it('sends only the stored auth header when called without opts', async () => {
    registerWkUrl('graphql', HINT, 'https://gql.example/query');
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    mediator.setRawAuth('Bearer t');
    await mediator.apiGet('graphql');
    const [call] = recorder.getCalls;
    expect(call.url).toBe('https://gql.example/query');
    expect(call.opts.extraHeaders).toEqual({ authorization: 'Bearer t' });
    expect(call.opts.onSetCookie).toBeUndefined();
  });
});

/** Session that makes the mediator sign every call (fabricated key, not a secret). */
const SIGNED_SESSION = {
  [HMAC_KEY_SLOT]: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  [HMAC_SIGNER_SLOT]: {
    algorithm: 'HMAC-SHA256',
    timestampHeader: 'X-Timestamp',
    nonceHeader: 'X-Nonce',
    signatureHeader: 'X-Signature',
  },
};

/** Caller headers whose signature name differs from the signer's only in case. */
const CLASHING_HEADERS = { 'x-signature': 'stale', cid: 'c-1' };

/**
 * Build a signing mediator wired to a recorder, with one URL registered.
 * @param recorder - Capture object.
 * @returns The signing mediator.
 */
function buildSigningMediator(recorder: IRecorder): IApiMediator {
  registerWkUrl('graphql', HINT, 'https://gql.example/query');
  const mediator = buildMediator(recorder);
  mediator.setSessionContext(SIGNED_SESSION);
  return mediator;
}

describe('ApiMediator — HMAC headers win a caller header in any letter case', () => {
  it('replaces a caller x-signature on GET', async () => {
    const recorder = makeRecorder();
    const mediator = buildSigningMediator(recorder);
    await mediator.apiGet('graphql', { extraHeaders: CLASHING_HEADERS });
    const headers = recorder.getCalls[0].opts.extraHeaders;
    expect(headers).not.toHaveProperty('x-signature');
    expect(headers).toHaveProperty('cid', 'c-1');
    expect(headers['X-Signature']).not.toBe('stale');
  });

  it('replaces a caller x-signature on POST', async () => {
    const recorder = makeRecorder();
    const mediator = buildSigningMediator(recorder);
    await mediator.apiPost('graphql', { a: 1 }, { extraHeaders: CLASHING_HEADERS });
    const headers = recorder.postCalls[0].opts.extraHeaders;
    expect(headers).not.toHaveProperty('x-signature');
    expect(headers).toHaveProperty('cid', 'c-1');
    expect(headers['X-Signature']).not.toBe('stale');
  });
});

/**
 * The operation label exists to make a bank-side GraphQL failure traceable,
 * so it must derive **only** from an executable operation definition. A name
 * that merely appears in a comment or a string literal is not the operation
 * being run, and labelling with it would break the anonymous-error contract
 * that callers match on.
 */
const OPERATION_LABEL_CASES: readonly { label: string; document: string; expected: string }[] = [
  {
    label: 'omits the label for an anonymous document',
    document: '{ movements { id } }',
    expected: 'graphql errors: bad',
  },
  {
    label: 'ignores an operation name that appears only inside a comment',
    document: '# query Stale\n{ movements { id } }',
    expected: 'graphql errors: bad',
  },
  {
    label: 'ignores an operation name that appears only inside a string literal',
    document: '{ movements(note: "query Stale") { id } }',
    expected: 'graphql errors: bad',
  },
  {
    label: 'names a real operation that follows a comment',
    document: '# fetches movements\nquery Movements { movements { id } }',
    expected: 'graphql errors [Movements]: bad',
  },
];

describe('ApiMediator/apiQuery', () => {
  it('unwraps {data: T} to succeed(data)', async () => {
    registerWkQuery('customer', HINT, 'query Customer { me { id } }');
    const recorder = makeRecorder();
    recorder.queryResult = succeed({ data: { customerId: 'c-1' } });
    const mediator = buildMediator(recorder);
    const result = await mediator.apiQuery<{ customerId: string }>('customer', { token: 't' });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.customerId).toBe('c-1');
  });

  it('{errors: [...]} converts to fail with "graphql errors:" prefix', async () => {
    registerWkQuery('transactions', HINT, 'query Tx { movements { id } }');
    const recorder = makeRecorder();
    recorder.queryResult = succeed({ errors: [{ message: 'bad' }] });
    const mediator = buildMediator(recorder);
    const result = await mediator.apiQuery('transactions', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('graphql errors');
  });

  it('names the failing operation so the bank-side error is traceable', async () => {
    const doc = 'query Movements($id: ID!) { movements(id: $id) { id } }';
    registerWkQuery('transactions', HINT, doc);
    const recorder = makeRecorder();
    recorder.queryResult = succeed({
      errors: [{ message: 'Request failed with status code 500' }],
    });
    const mediator = buildMediator(recorder);
    const result = await mediator.apiQuery('transactions', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result))
      expect(result.errorMessage).toBe(
        'graphql errors [Movements]: Request failed with status code 500',
      );
  });

  it.each(OPERATION_LABEL_CASES)('$label', async ({ document, expected }) => {
    registerWkQuery('transactions', HINT, document);
    const recorder = makeRecorder();
    recorder.queryResult = succeed({ errors: [{ message: 'bad' }] });
    const mediator = buildMediator(recorder);
    const result = await mediator.apiQuery('transactions', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toBe(expected);
  });

  it('response missing data and no errors returns "missing data"', async () => {
    registerWkQuery('balance', HINT, 'query Bal { balance }');
    const recorder = makeRecorder();
    recorder.queryResult = succeed({});
    const mediator = buildMediator(recorder);
    const result = await mediator.apiQuery('balance', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('missing data');
  });

  it('unknown WK query name returns failure and does not call transport', async () => {
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    const result = await mediator.apiQuery('customer', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    expect(recorder.queryCalls.length).toBe(0);
  });

  it('fires graphqlStrategy.query with Bearer headers when set', async () => {
    registerWkQuery('customer', HINT, 'query { me { id } }');
    const recorder = makeRecorder();
    recorder.queryResult = succeed({ data: { ok: true } });
    const mediator = buildMediator(recorder);
    mediator.setBearer('abc');
    await mediator.apiQuery('customer', { x: 1 });
    expect(recorder.queryCalls.length).toBe(1);
    expect(recorder.queryCalls[0].opts.extraHeaders.authorization).toBe('Bearer abc');
  });
});

/**
 * Resolve this test file's directory via import.meta.url (ESM-safe).
 * @returns Absolute directory of this test file.
 */
function thisDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return dirname(thisFile);
}

describe('ApiMediator — query-string append + GraphQL envelope edges', () => {
  it('appendQuery merges with `&` when URL already carries `?key=v`', async () => {
    registerWkUrl('identity.deviceToken', HINT, 'https://id.example/devices/token?lang=he');
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    await mediator.apiPost('identity.deviceToken', { foo: 'bar' }, { query: { extra: '1' } });
    expect(recorder.postCalls.length).toBe(1);
    expect(recorder.postCalls[0].url).toContain('?lang=he&extra=1');
  });

  it('appendQuery returns URL unchanged when query map is empty', async () => {
    registerWkUrl('identity.deviceToken', HINT, 'https://id.example/devices/token');
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    await mediator.apiPost('identity.deviceToken', { foo: 'bar' });
    expect(recorder.postCalls[0].url).toBe('https://id.example/devices/token');
  });

  it('GraphQL envelope with empty errors[] surfaces "<unknown>" message label', async () => {
    registerWkQuery('customer', HINT, 'query { me { id } }');
    const recorder = makeRecorder();
    const errorEnvelope = { errors: [{ message: '' }] };
    recorder.queryResult = succeed(errorEnvelope);
    const mediator = buildMediator(recorder);
    const result = await mediator.apiQuery('customer', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('<unknown>');
  });

  it('GraphQL envelope with non-string error message surfaces "<unknown>"', async () => {
    registerWkQuery('customer', HINT, 'query { me { id } }');
    const recorder = makeRecorder();
    const errorEnvelope = { errors: [{ message: 42 }] };
    recorder.queryResult = succeed(errorEnvelope);
    const mediator = buildMediator(recorder);
    const result = await mediator.apiQuery('customer', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('<unknown>');
  });
});

describe('ApiMediator/reuseContract', () => {
  it('source file contains zero bank-name literals', () => {
    const here = thisDir();
    const filePath = resolvePath(
      here,
      '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.ts',
    );
    const source = readFileSync(filePath, 'utf8');
    const bannedNamesPattern =
      /oneZero|amex|isracard|hapoalim|discount|visaCal|max|beinleumi|massad|mercantile|otsarHahayal|pagi/i;
    const hit = bannedNamesPattern.exec(source);
    expect(hit).toBeNull();
  });
});

describe('ApiMediator/createBrowserBackedHeadlessApiMediator', () => {
  it('OZ-AM-01 — factory returns a mediator carrying the standard surface and a dispose hook', () => {
    const mediator = createBrowserBackedHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      identityOriginUrl: 'https://id.example',
      graphqlUrl: 'https://gql.example/graphql',
    });
    expect(typeof mediator.apiPost).toBe('function');
    expect(typeof mediator.apiGet).toBe('function');
    expect(typeof mediator.apiQuery).toBe('function');
    expect(typeof mediator.dispose).toBe('function');
  });

  it('OZ-AM-02 — dispose() delegates to the strategy and is idempotent (no throw, no launch)', async () => {
    const mediator = createBrowserBackedHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      identityOriginUrl: 'https://id.example',
      graphqlUrl: 'https://gql.example/graphql',
    });
    await expect(mediator.dispose?.()).resolves.toBeUndefined();
    await expect(mediator.dispose?.()).resolves.toBeUndefined();
  });

  it('OZ-AM-03 — native createHeadlessApiMediator leaves dispose undefined', () => {
    const mediator = createHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
    });
    expect(mediator.dispose).toBeUndefined();
  });

  it.each([
    ['without cookie domains', { sessionCookies: true }, false],
    ['with cookie domains', { sessionCookies: true, cookieDomains: ['id.example'] }, true],
  ])('UT-CS-06 — native mediator cookie session %s', (_label, flags, isExposed) => {
    const mediator = createHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
      ...flags,
    });
    const hasCookies = mediator.cookies !== undefined;
    expect(hasCookies).toBe(isExposed);
  });
});

const POLICY_CALLS = [
  {
    label: 'REST',
    prefix: 'GET https://id.example/devices/token',
    /**
     * Exercise the identity transport through the mediator.
     * @param mediator - Mediator configured with bank policies.
     * @param opts - Per-call policy and hooks.
     * @returns The REST outcome.
     */
    call: (mediator: IApiMediator, opts?: IApiQueryOpts): Promise<Procedure<unknown>> =>
      mediator.apiGet('identity.deviceToken', opts),
  },
  {
    label: 'REST POST',
    prefix: 'POST https://id.example/devices/token',
    /**
     * Exercise a POST through the same mediator.
     * @param mediator - Mediator configured with bank policies.
     * @param opts - Per-call policy and hooks.
     * @returns The REST outcome.
     */
    call: (mediator: IApiMediator, opts?: IApiQueryOpts): Promise<Procedure<unknown>> =>
      mediator.apiPost('identity.deviceToken', {}, opts),
  },
  {
    label: 'GraphQL',
    prefix: 'POST https://gql.example/graphql',
    /**
     * Exercise the independent GraphQL transport through the same mediator.
     * @param mediator - Mediator configured with bank policies.
     * @param opts - Per-call policy and hooks.
     * @returns The GraphQL outcome.
     */
    call: (mediator: IApiMediator, opts?: IApiQueryOpts): Promise<Procedure<unknown>> =>
      mediator.apiQuery('customer', {}, opts),
  },
];

/**
 * Builds real transports with synthetic endpoints and optional bank policies.
 * @param options - Bank-wide transport defaults.
 * @returns The mediator under test.
 */
function buildPolicyMediator(options: INativeFetchOptions = {}): IApiMediator {
  return createHeadlessApiMediator({
    bankHint: HINT,
    identityBaseUrl: 'https://id.example/v1/',
    graphqlUrl: 'https://gql.example/graphql',
    ...options,
  });
}

describe('ApiMediator — redirect policy', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    registerWkUrl('identity.deviceToken', HINT, 'https://id.example/devices/token');
    registerWkQuery('customer', HINT, 'query Customer { me { id } }');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('hands a POST call policy to the transport', async () => {
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    await mediator.apiPost('identity.deviceToken', {}, { policy: { redirect: 'reject' } });
    const call = recorder.postCalls[0];
    expect(call.opts.redirect).toBe('reject');
  });

  it('hands a GET call policy to the transport', async () => {
    const recorder = makeRecorder();
    const mediator = buildMediator(recorder);
    await mediator.apiGet('identity.deviceToken', { policy: { redirect: 'follow' } });
    const call = recorder.getCalls[0];
    expect(call.opts.redirect).toBe('follow');
  });

  it.each(POLICY_CALLS)('honors a $label per-call redirect refusal', async ({ call, prefix }) => {
    const response = new Response(null, { status: 302, headers: { location: '/elsewhere' } });
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const mediator = buildPolicyMediator();
    const result = await call(mediator, { policy: { redirect: 'reject' } });
    expect(result).toMatchObject({
      success: false,
      errorMessage: `${prefix} HTTP 302 redirect refused`,
    });
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });

  it.each(POLICY_CALLS)(
    'lets a $label call override the bank redirect default',
    async ({ call }) => {
      const response = new Response('{"data":{}}', { status: 200 });
      const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
      const mediator = buildPolicyMediator({ redirectPolicy: 'reject' });
      const result = await call(mediator, { policy: { redirect: 'follow' } });
      expect(result.success).toBe(true);
      expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('redirect');
    },
  );

  it.each(POLICY_CALLS)(
    'delivers only declared headers to the $label call sink',
    async ({ call }) => {
      const headers = { 'X-Trace': 'synthetic-trace', 'X-Undeclared': 'not-requested' };
      const response = new Response('{"data":{}}', { headers });
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
      const take = jest.fn<number, Parameters<IResponseHeaderSink['take']>>().mockReturnValue(1);
      const headerSink = { names: ['x-trace'], take };
      const mediator = buildPolicyMediator();
      const result = await call(mediator, { policy: { headerSink } });
      expect(result.success).toBe(true);
      expect(take).toHaveBeenCalledTimes(1);
      expect(take).toHaveBeenCalledWith({ 'x-trace': 'synthetic-trace' }, 200, '');
    },
  );

  it.each(POLICY_CALLS)('runs $label under the bank redirect default', async ({ call, prefix }) => {
    const redirect = new Response(null, { status: 302, headers: { location: '/elsewhere' } });
    /**
     * Answer every request with the 302.
     * @returns The redirect response.
     */
    function answerRedirect(): Promise<Response> {
      return Promise.resolve(redirect);
    }
    globalThis.fetch = answerRedirect;
    const mediator = createHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
      redirectPolicy: 'reject',
    });
    const result = await call(mediator);
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe(`${prefix} HTTP 302 redirect refused`);
  });

  it.each(POLICY_CALLS)('runs $label under the bank status policy', async ({ call, prefix }) => {
    const partial = new Response('{}', { status: 207 });
    /**
     * Answer every request with the 207.
     * @returns The partial-content response.
     */
    function answerPartial(): Promise<Response> {
      return Promise.resolve(partial);
    }
    globalThis.fetch = answerPartial;
    const mediator = createHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
      statusPolicy: { 207: 'fail' },
    });
    const result = await call(mediator);
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe(`${prefix} HTTP 207`);
  });

  it.each(POLICY_CALLS)('omits bank text from $label failures', async ({ call, prefix }) => {
    const response = new Response('SYNTHETIC private bank reply', { status: 500 });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const mediator = buildPolicyMediator({ omitBankText: true });
    const result = await call(mediator);
    const errorMessage = `${prefix} 500: response body omitted`;
    expect(result).toMatchObject({ success: false, errorMessage });
  });

  it.each(POLICY_CALLS)(
    'keeps a policy-approved empty $label response successful',
    async ({ call }) => {
      const response = new Response(null, { status: 204 });
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
      const mediator = createHeadlessApiMediator({
        bankHint: HINT,
        identityBaseUrl: 'https://id.example/v1/',
        graphqlUrl: 'https://gql.example/graphql',
        statusPolicy: { 204: 'empty' },
      });
      const result = await call(mediator);
      expect(result).toEqual({ success: true, value: {} });
    },
  );

  it('does not reuse a concurrent query empty verdict for a malformed envelope', async () => {
    const empty = new Response(null, { status: 204 });
    const malformed = new Response('{}', { status: 200 });
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected fetch'))
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(malformed);
    const mediator = createHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
      statusPolicy: { 204: 'empty' },
    });
    const [approved, rejected] = await Promise.all([
      mediator.apiQuery('customer', {}),
      mediator.apiQuery('customer', {}),
    ]);
    expect(approved).toEqual({ success: true, value: {} });
    expect(rejected).toMatchObject({
      success: false,
      errorMessage: 'graphql response [Customer] missing data',
    });
  });
});
