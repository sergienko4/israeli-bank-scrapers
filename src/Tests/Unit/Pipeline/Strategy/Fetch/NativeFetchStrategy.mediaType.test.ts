/**
 * The native transport checks an answer's media type: the call's own
 * `mediaType`, else the bank's default for the call's response kind. The
 * check runs after WAF classification and the status policy, before the
 * reader, and names no header value.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IFetchOpts } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { cappedNative } from '../../../../Helpers/CappedTransport.js';
import { fakeFetch, type IFetchFake } from '../../../../Helpers/FakeFetch.js';

const BASE_URL = 'https://api.bank.example/v1/';
const SAFE_URL = `${BASE_URL}portal`;
const PAGE = '<!doctype html><html><body>hi</body></html>';
const REFUSED = `GET ${SAFE_URL} unexpected media type`;
const HTML_PAGE: IFetchOpts = {
  extraHeaders: {},
  responseKind: 'document',
  mediaType: 'text/html',
};
const JSON_CALL: IFetchOpts = { extraHeaders: {} };
const DOCUMENT: IFetchOpts = { extraHeaders: {}, responseKind: 'document' };

const PLAIN = cappedNative(BASE_URL);
const JSON_BANK = cappedNative(BASE_URL, {
  mediaTypes: { json: 'application/json' },
  statusPolicy: { 207: 'fail' },
});

/**
 * Answer every request with one body, status and content type.
 * @param body - Response body.
 * @param contentType - Content-type header, or false for none.
 * @param status - HTTP status.
 * @returns The fake, for request assertions.
 */
function serve(body: string, contentType: string | false, status = 200): IFetchFake {
  const blob = new Blob([body]);
  const headers: Record<string, string> =
    contentType === false ? {} : { 'content-type': contentType };
  const fake = fakeFetch((): Response => new Response(blob, { status, headers }));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * GET the portal on a strategy.
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

describe('NativeFetchStrategy — answer media type', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('accepts the call media type in any case, with parameters', async () => {
    serve(PAGE, 'Text/HTML ; charset=UTF-8');
    const result = await getPortal(PLAIN, HTML_PAGE);
    expect(result).toEqual({ success: true, value: {} });
  });

  it('refuses another media type without echoing it', async () => {
    serve(PAGE, 'application/json; secret=1');
    const result = await getPortal(PLAIN, HTML_PAGE);
    const expected = { success: false, errorType: ScraperErrorTypes.Generic };
    expect(result).toMatchObject({ ...expected, errorMessage: REFUSED });
  });

  it('refuses an answer with no content type', async () => {
    serve(PAGE, false);
    const result = await getPortal(PLAIN, HTML_PAGE);
    expect(result).toMatchObject({ success: false, errorMessage: REFUSED });
  });

  it('applies the bank default for the call response kind', async () => {
    serve('{"ok":true}', 'application/json;charset=UTF-8');
    const accepted = await getPortal(JSON_BANK, JSON_CALL);
    serve('{"ok":true}', 'text/plain');
    const refused = await getPortal(JSON_BANK, JSON_CALL);
    expect(accepted).toEqual({ success: true, value: { ok: true } });
    expect(refused).toMatchObject({ success: false, errorMessage: REFUSED });
  });

  it('leaves a kind the bank names no type for unchecked', async () => {
    serve(PAGE, 'text/plain');
    const result = await getPortal(JSON_BANK, DOCUMENT);
    expect(result).toEqual({ success: true, value: {} });
  });

  it('lets the call media type override the bank default', async () => {
    serve('{"ok":true}', 'text/html');
    const result = await getPortal(JSON_BANK, { ...JSON_CALL, mediaType: 'text/html' });
    expect(result).toEqual({ success: true, value: { ok: true } });
  });

  it('checks no media type on a bank and call naming none', async () => {
    serve('{"ok":true}', 'text/plain');
    const result = await getPortal(PLAIN, JSON_CALL);
    expect(result).toEqual({ success: true, value: { ok: true } });
  });

  it('decides the status policy before the media type', async () => {
    serve('{"partial":true}', 'text/plain', 207);
    const result = await getPortal(JSON_BANK, JSON_CALL);
    expect(result).toMatchObject({ success: false, errorMessage: `GET ${SAFE_URL} HTTP 207` });
  });
});
