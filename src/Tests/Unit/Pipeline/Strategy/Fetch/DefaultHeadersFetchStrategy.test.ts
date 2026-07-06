/**
 * DefaultHeadersFetchStrategy unit tests — proves the decorator merges a
 * fixed default-header bag UNDER each call's per-call headers (per-call and
 * rawAuth-merged headers win), and that an empty bag is a transparent
 * pass-through (returns the inner strategy unchanged).
 */

import {
  DefaultHeadersFetchStrategy,
  withDefaultHeaders,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/DefaultHeadersFetchStrategy.js';
import type {
  IFetchOpts,
  IFetchStrategy,
  PostData,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Mutable capture of the opts each spy method last received. */
interface ICapture {
  postOpts: IFetchOpts;
  getOpts: IFetchOpts;
}

/**
 * Build a spy IFetchStrategy that records the opts it was called with.
 * @param cap - Mutable capture record (mutated on each call).
 * @returns Spy strategy writing into `cap`.
 */
function makeSpyStrategy(cap: ICapture): IFetchStrategy {
  return {
    /**
     * Record POST opts, then succeed with an empty body.
     * @param _url - Ignored target URL.
     * @param _data - Ignored POST body.
     * @param opts - Captured per-call opts.
     * @returns Empty success.
     */
    fetchPost: <T>(_url: string, _data: PostData, opts: IFetchOpts): Promise<Procedure<T>> => {
      cap.postOpts = opts;
      const ok = succeed({} as T);
      return Promise.resolve(ok);
    },
    /**
     * Record GET opts, then succeed with an empty body.
     * @param _url - Ignored target URL.
     * @param opts - Captured per-call opts.
     * @returns Empty success.
     */
    fetchGet: <T>(_url: string, opts: IFetchOpts): Promise<Procedure<T>> => {
      cap.getOpts = opts;
      const ok = succeed({} as T);
      return Promise.resolve(ok);
    },
  };
}

/**
 * Fresh capture seeded with the default opts (never undefined).
 * @returns New capture record.
 */
function freshCapture(): ICapture {
  return { postOpts: DEFAULT_FETCH_OPTS, getOpts: DEFAULT_FETCH_OPTS };
}

describe('withDefaultHeaders', () => {
  it('returns the inner strategy unchanged when the bag is empty', () => {
    const cap = freshCapture();
    const inner = makeSpyStrategy(cap);
    const result = withDefaultHeaders(inner, {});
    expect(result).toBe(inner);
  });

  it('wraps the inner strategy when the bag is non-empty', () => {
    const cap = freshCapture();
    const inner = makeSpyStrategy(cap);
    const wrapped = withDefaultHeaders(inner, { Accept: 'application/json' });
    expect(wrapped).toBeInstanceOf(DefaultHeadersFetchStrategy);
  });

  it('merges defaults UNDER per-call POST headers (per-call wins)', async () => {
    const cap = freshCapture();
    const inner = makeSpyStrategy(cap);
    const wrapped = withDefaultHeaders(inner, { Accept: 'application/json', 'X-Site-Id': 'a' });
    const perCall: IFetchOpts = { extraHeaders: { 'X-Site-Id': 'b', authorization: 'tok' } };
    await wrapped.fetchPost('u', {}, perCall);
    expect(cap.postOpts.extraHeaders).toEqual({
      Accept: 'application/json',
      'X-Site-Id': 'b',
      authorization: 'tok',
    });
  });

  it('injects defaults into a GET that carried no extra headers', async () => {
    const cap = freshCapture();
    const inner = makeSpyStrategy(cap);
    const wrapped = withDefaultHeaders(inner, { Accept: 'application/json' });
    await wrapped.fetchGet('u', { extraHeaders: {} });
    expect(cap.getOpts.extraHeaders).toEqual({ Accept: 'application/json' });
  });

  it('preserves non-header opts (onSetCookie) while merging headers', async () => {
    const cap = freshCapture();
    const inner = makeSpyStrategy(cap);
    /**
     * No-op cookie sink.
     * @returns Zero (nothing ingested).
     */
    const onSetCookie = (): number => 0;
    const wrapped = withDefaultHeaders(inner, { Accept: 'application/json' });
    await wrapped.fetchGet('u', { extraHeaders: {}, onSetCookie });
    expect(cap.getOpts.onSetCookie).toBe(onSetCookie);
  });
});
