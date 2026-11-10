/**
 * UT-ST — the native transport reads a document step's answer and
 * applies the bank's status policy after WAF classification and before
 * parsing. A transport built without a policy reads JSON exactly as before.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IFetchOpts } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { cappedNative } from '../../../../Helpers/CappedTransport.js';
import {
  CLOUDFLARE_BLOCK_PAGE,
  CLOUDFLARE_CHALLENGE_HEADERS,
  CLOUDFLARE_CHALLENGE_PAGE,
} from '../../../../Helpers/EdgeBlockPages.js';
import { fakeFetch, type IFetchFake } from '../../../../Helpers/FakeFetch.js';

const BASE_URL = 'https://api.bank.example/v1/';
const SAFE_URL = `${BASE_URL}portal`;
const LANDING_HTML = '<!doctype html><html><body><div id="portal-ready">hi</div></body></html>';
const MARKER = 'portal-ready';
const DOCUMENT: IFetchOpts = { extraHeaders: {}, responseKind: 'document' };
const MARKED: IFetchOpts = { ...DOCUMENT, documentMarker: MARKER };
const JSON_STEP: IFetchOpts = { extraHeaders: {} };

const GOVERNED = cappedNative(BASE_URL, {
  statusPolicy: { 204: 'empty', 207: 'fail' },
});
const PLAIN = cappedNative(BASE_URL);
const EMPTY_200 = cappedNative(BASE_URL, {
  statusPolicy: { 200: 'empty' },
});

/**
 * Answer every request with one response.
 * @param response - The response fetch resolves with.
 * @returns The fake, for request assertions.
 */
function serve(response: Response): IFetchFake {
  const fake = fakeFetch((): Response => response);
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * GET the portal page on a strategy.
 * @param strategy - Transport under test.
 * @param opts - The call's fetch options.
 * @returns The transport's outcome.
 */
function getPortal(
  strategy: ReturnType<typeof cappedNative>,
  opts: IFetchOpts,
): Promise<Procedure<unknown>> {
  return strategy.fetchGet<unknown>('portal?sid=secret', opts);
}

describe('NativeFetchStrategy — document responses and status policy', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('UT-ST-07 discards an HTML 200 on a document step', async () => {
    const response = new Response(LANDING_HTML, { status: 200 });
    serve(response);
    const result = await getPortal(PLAIN, DOCUMENT);
    expect(result).toEqual({ success: true, value: {} });
  });

  it('accepts a document carrying its marker', async () => {
    const response = new Response(LANDING_HTML, { status: 200 });
    serve(response);
    const result = await getPortal(PLAIN, MARKED);
    expect(result).toEqual({ success: true, value: {} });
  });

  it.each([
    ['without a status policy', PLAIN],
    ['with an empty status policy', EMPTY_200],
  ] as const)('refuses a document missing its marker %s', async (_label, strategy) => {
    const response = new Response('<html><body>maintenance</body></html>', { status: 200 });
    serve(response);
    const result = await getPortal(strategy, MARKED);
    const expected = { errorType: ScraperErrorTypes.Generic };
    expect(result).toMatchObject({ success: false, ...expected });
    expect(result).toMatchObject({ errorMessage: `GET ${SAFE_URL} document unverified` });
  });

  it('reports a block page on a document step as a WAF block', async () => {
    const response = new Response(CLOUDFLARE_BLOCK_PAGE, { status: 403 });
    serve(response);
    const result = await getPortal(PLAIN, DOCUMENT);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
  });

  it('reports a 200 challenge on a document step as a WAF block', async () => {
    const response = new Response(CLOUDFLARE_CHALLENGE_PAGE, {
      status: 200,
      headers: CLOUDFLARE_CHALLENGE_HEADERS,
    });
    serve(response);
    const result = await getPortal(PLAIN, DOCUMENT);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
  });

  it('classifies a challenge before the bank empty policy', async () => {
    serve(
      new Response(CLOUDFLARE_CHALLENGE_PAGE, {
        status: 200,
        headers: CLOUDFLARE_CHALLENGE_HEADERS,
      }),
    );
    const result = await getPortal(EMPTY_200, JSON_STEP);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
  });

  it('keeps the parse error for HTML on a json step', async () => {
    const response = new Response(LANDING_HTML, { status: 200 });
    serve(response);
    const result = await getPortal(PLAIN, JSON_STEP);
    const message = `GET ${SAFE_URL} parse error`;
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    expect(result).toMatchObject({ errorMessage: expect.stringContaining(message) as string });
  });

  it('UT-ST-08 answers {} for a 204 the bank marks empty', async () => {
    const response = new Response(null, { status: 204 });
    serve(response);
    const result = await getPortal(GOVERNED, JSON_STEP);
    expect(result).toEqual({ success: true, value: {} });
  });

  it('refuses a 207 the bank marks fail', async () => {
    const response = new Response('{"partial":true}', { status: 207 });
    serve(response);
    const result = await GOVERNED.fetchPost<unknown>('portal?sid=secret', {}, JSON_STEP);
    expect(result).toMatchObject({ success: false, errorMessage: `POST ${SAFE_URL} HTTP 207` });
  });

  it('refuses a 204 on a marked document step', async () => {
    const response = new Response(null, { status: 204 });
    serve(response);
    const result = await getPortal(GOVERNED, MARKED);
    expect(result).toMatchObject({ errorMessage: `GET ${SAFE_URL} document unverified` });
  });

  it('answers {} for a 204 on an unmarked document step', async () => {
    const response = new Response(null, { status: 204 });
    serve(response);
    const result = await getPortal(GOVERNED, DOCUMENT);
    expect(result).toEqual({ success: true, value: {} });
  });

  it('leaves a 204 to the JSON parser on a bank without a policy', async () => {
    const response = new Response(null, { status: 204 });
    serve(response);
    const result = await getPortal(PLAIN, JSON_STEP);
    expect(result).toMatchObject({
      errorMessage: expect.stringContaining('parse error') as string,
    });
  });
});
