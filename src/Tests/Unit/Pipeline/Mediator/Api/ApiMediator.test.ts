/**
 * ApiMediator — unit tests for the Black Box headless transport mediator.
 * Covers WK URL/query resolution, Bearer injection, GraphQL envelope unwrap,
 * and the reuse-contract regex guard (no bank names leak into the file).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  createApiMediator,
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
});

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
