/**
 * In-page POST: request timeout and response metadata.
 *
 * The property worth testing is not that metadata is returned — it is that a
 * bounced response is distinguishable from an empty one. A WAF challenge and an
 * expired session both commonly arrive as a 200 carrying HTML, or as a redirect
 * to a login origin; parsed as JSON both yield null, exactly like a genuinely
 * empty account. These tests pin the cases where the body must NOT be parsed.
 */

import type { Page } from 'playwright-core';

import fetchPostWithinPageWithMetadata, {
  type IFetchPostWithMetadataOptions,
} from '../../../../Scrapers/Pipeline/Mediator/Network/Fetch/PageFetchPostMetadata.js';

/** What a stubbed page should answer with. */
interface IStubResponse {
  body?: string;
  status?: number;
  contentType?: string;
  redirected?: boolean;
  finalUrl?: string;
}

/** The tuple the in-page fetch hands back. */
type PostTuple = readonly [string, number, string, boolean, string];

/** Evaluate args the function under test builds for the page. */
interface IEvaluateArgs {
  innerTimeoutMs: number;
}

let lastArgs: IEvaluateArgs | undefined;

/**
 * Stand in for a Playwright page: answer the serialised fn with a fixed tuple,
 * and record the args it was called with so the timeout wiring can be checked.
 *
 * @param response - The transport facts the stub should report.
 * @returns A page-shaped stub accepted by the function under test.
 */
function pageReturning(response: IStubResponse): Page {
  const {
    body = '{"ok":true}',
    status = 200,
    contentType = 'application/json',
    redirected: isRedirected = false,
    finalUrl = 'https://provider.example/api',
  } = response;
  const text = status === 204 ? '' : body;
  /**
   * Record the evaluate args and answer with the fixed tuple.
   *
   * @param _fn - The serialised page function; never executed here.
   * @param args - Evaluate args built by the function under test.
   * @param args.innerTimeoutMs - Timeout the caller asked for, if any.
   * @returns The stubbed transport tuple.
   */
  const evaluate = (_fn: unknown, args: IEvaluateArgs): Promise<PostTuple> => {
    lastArgs = args;
    return Promise.resolve([text, status, contentType, isRedirected, finalUrl]);
  };
  return { evaluate } as unknown as Page;
}

const OPTS: IFetchPostWithMetadataOptions = { data: { q: 1 } };
const URL_UNDER_TEST = 'https://provider.example/api';

describe('fetchPostWithinPageWithMetadata', () => {
  beforeEach(() => {
    lastArgs = undefined;
  });

  it('parses a clean JSON response and reports the transport facts', async () => {
    const page = pageReturning({});
    const result = await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, OPTS);
    expect(result.envelope).toEqual({ ok: true });
    expect(result.http.status).toBe(200);
    expect(result.http.redirected).toBe(false);
    expect(result.http.sameOrigin).toBe(true);
  });

  it('does NOT parse a redirected response, even at 200', async () => {
    // The login-page bounce. Parsing it would produce the same null a genuinely
    // empty account gives, erasing the only signal that anything went wrong.
    const page = pageReturning({ redirected: true, finalUrl: 'https://login.example/signin' });
    const result = await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, OPTS);
    expect(result.envelope).toBeNull();
    expect(result.http.redirected).toBe(true);
    expect(result.http.sameOrigin).toBe(false);
  });

  it('does NOT parse an HTML body served with a 200', async () => {
    // The WAF-challenge shape.
    const html = '<html>checking your browser</html>';
    const page = pageReturning({ body: html, contentType: 'text/html' });
    const result = await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, OPTS);
    expect(result.envelope).toBeNull();
    expect(result.http.contentType).toBe('text/html');
  });

  it('reports a non-2xx status without throwing', async () => {
    const page = pageReturning({ status: 403, body: 'forbidden', contentType: 'text/plain' });
    const result = await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, OPTS);
    expect(result.http.status).toBe(403);
    expect(result.envelope).toBeNull();
  });

  it('treats an empty 204 as an empty envelope, not a failure', async () => {
    // Asserted with an absent content-type because servers routinely omit one
    // on a 204.
    const page = pageReturning({ status: 204, contentType: '' });
    const result = await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, OPTS);
    expect(result.http.status).toBe(204);
    // `{}`, not null: the request succeeded and carried no content. Collapsing
    // it to null would put it in the same bucket as a WAF bounce.
    expect(result.envelope).toEqual({});
  });

  it('survives a body that claims JSON and is not', async () => {
    const page = pageReturning({ body: 'not json at all' });
    const result = await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, OPTS);
    expect(result.envelope).toBeNull();
    expect(result.http.status).toBe(200);
  });

  it('flags a cross-origin response even when it was not a redirect', async () => {
    const page = pageReturning({ finalUrl: 'https://other.example/api' });
    const result = await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, OPTS);
    expect(result.http.sameOrigin).toBe(false);
  });

  it('passes the caller timeout through to the in-page fetch', async () => {
    const page = pageReturning({});
    const withTimeout: IFetchPostWithMetadataOptions = { ...OPTS, timeoutMs: 15_000 };
    await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, withTimeout);
    expect(lastArgs?.innerTimeoutMs).toBe(15_000);
  });

  it('sends no timeout when the caller sets none', async () => {
    // 0 means "no timeout" to the page function, which only arms AbortSignal
    // above zero. The plain fetchPostWithinPage path is untouched by any of
    // this — it keeps its own evaluate-args object exactly as it was.
    const page = pageReturning({});
    await fetchPostWithinPageWithMetadata(page, URL_UNDER_TEST, OPTS);
    expect(lastArgs?.innerTimeoutMs).toBe(0);
  });
});
