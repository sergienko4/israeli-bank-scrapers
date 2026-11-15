/**
 * Edge coverage for ApiMediator.transport helpers that the mediator
 * integration tests do not naturally reach: query-string appending onto a
 * URL that already carries a `?`, the GraphQL transport-failure
 * short-circuit in fireQuery, and the stored Authorization merge.
 *
 * The URL and header helpers are module-private; these cases observe their
 * output through the public fireGet entry point.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  fireGet,
  fireQuery,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.transport.js';
import type {
  IFireGetArgs,
  IFireQueryArgs,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import {
  fail,
  isOk,
  type Procedure,
  succeed,
} from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** One captured outbound GET. */
interface ICapturedGet {
  url: string;
  headers: Record<string, string>;
}

/** FireGet args plus the slot its transport records into. */
interface IGetProbe {
  args: IFireGetArgs;
  captured: ICapturedGet;
}

/** Inputs for one fireGet probe. */
interface IGetProbeInput {
  url: string;
  rawAuth: string;
  extraHeaders: Record<string, string>;
  query: Record<string, string>;
}

/**
 * Build fireGet args whose transport records the final URL and headers.
 * @param input - Request URL, auth value, per-call headers and query params.
 * @returns FireGet args and the capture slot.
 */
function probeGet(input: IGetProbeInput): IGetProbe {
  const captured: ICapturedGet = { url: '', headers: {} };
  /**
   * Record the final URL and headers, then answer with a success.
   * @param finalUrl - URL after query assembly.
   * @param opts - Merged fetch options.
   * @param opts.extraHeaders - Headers the request would send.
   * @returns Successful procedure.
   */
  const fetchGet = <T>(
    finalUrl: string,
    opts: { extraHeaders: Record<string, string> },
  ): Promise<Procedure<T>> => {
    captured.url = finalUrl;
    captured.headers = opts.extraHeaders;
    const answer = succeed(undefined as T);
    return Promise.resolve(answer);
  };
  const deps = { fetchStrategy: { fetchGet } };
  const raw = { deps, ...input };
  return { args: raw as unknown as IFireGetArgs, captured };
}

/**
 * GraphQL query stub that always resolves to a failed procedure.
 * @returns Failed transport procedure.
 */
function failingQuery(): Promise<Procedure<unknown>> {
  const failure = fail(ScraperErrorTypes.Generic, 'graphql transport down');
  return Promise.resolve(failure);
}

/**
 * Build fireQuery args whose GraphQL strategy always fails.
 * @returns Cast fireQuery args with a failing transport.
 */
function argsWithFailingGraphql(): IFireQueryArgs {
  const deps = { graphqlStrategy: { query: failingQuery } };
  const raw = { deps, queryString: 'q', variables: {}, rawAuth: '', extraHeaders: {} };
  return raw as unknown as IFireQueryArgs;
}

describe('ApiMediator.transport query assembly (edge)', () => {
  it('joins with & when the url already has a query string', async () => {
    const { args, captured } = probeGet({
      url: 'https://x.test/p?a=1',
      rawAuth: '',
      extraHeaders: {},
      query: { b: '2' },
    });
    await fireGet(args);
    expect(captured.url).toBe('https://x.test/p?a=1&b=2');
  });

  it('returns the url unchanged when no params are supplied', async () => {
    const { args, captured } = probeGet({
      url: 'https://x.test/p',
      rawAuth: '',
      extraHeaders: {},
      query: {},
    });
    await fireGet(args);
    expect(captured.url).toBe('https://x.test/p');
  });

  it.each([
    ['https://x.test/p#s', 'https://x.test/p?b=2#s'],
    ['https://x.test/p?a=1#s', 'https://x.test/p?a=1&b=2#s'],
    ['https://x.test/p#s?x=1', 'https://x.test/p?b=2#s?x=1'],
  ])('puts the params before the fragment of %s', async (url, expected) => {
    const { args, captured } = probeGet({ url, rawAuth: '', extraHeaders: {}, query: { b: '2' } });
    await fireGet(args);
    expect(captured.url).toBe(expected);
  });
});

describe('ApiMediator.transport.fireQuery (edge)', () => {
  it('propagates a failed GraphQL transport procedure', async () => {
    const args = argsWithFailingGraphql();
    const result = await fireQuery(args);
    const didSucceed = isOk(result);
    expect(didSucceed).toBe(false);
  });
});

describe('ApiMediator.transport header merge (edge)', () => {
  it('lets the stored token replace a caller Authorization in any case', async () => {
    const { args, captured } = probeGet({
      url: 'https://x.test/p',
      rawAuth: 'syn-stored',
      extraHeaders: { Authorization: 'syn-caller', 'X-Trace': 't' },
      query: {},
    });
    await fireGet(args);
    expect(captured.headers).toEqual({ 'X-Trace': 't', authorization: 'syn-stored' });
  });

  it('keeps the caller Authorization when no token is stored', async () => {
    const { args, captured } = probeGet({
      url: 'https://x.test/p',
      rawAuth: '',
      extraHeaders: { Authorization: 'syn-caller' },
      query: {},
    });
    await fireGet(args);
    expect(captured.headers).toEqual({ Authorization: 'syn-caller' });
  });
});
