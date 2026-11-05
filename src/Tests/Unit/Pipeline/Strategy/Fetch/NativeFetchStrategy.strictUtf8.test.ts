/**
 * N63 — the native transport can decode an answer's bytes as strict UTF-8:
 * the call's own `strictUtf8`, else the bank's. A malformed byte refuses the
 * call, naming no body, instead of becoming U+FFFD; the json, document and
 * text readers all decode this way. A leading BOM is dropped as `text()`
 * drops it, and a transport naming nothing reads bodies as before.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IFetchOpts } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch, type IFetchFake } from '../../../../Helpers/FakeFetch.js';

const BASE_URL = 'https://api.bank.example/v1/';
const REFUSED = `GET ${BASE_URL}portal body not utf-8`;
const JSON_CALL: IFetchOpts = { extraHeaders: {} };
const DOCUMENT: IFetchOpts = { extraHeaders: {}, responseKind: 'document' };
const TEXT: IFetchOpts = { extraHeaders: {}, responseKind: 'text' };

const PLAIN = new HeadlessNativeFetchStrategy(BASE_URL);
const STRICT_BANK = new HeadlessNativeFetchStrategy(BASE_URL, { strictUtf8: true });

/** `{"a":"<0xff>"}` — JSON whose one string holds a byte UTF-8 never uses. */
const BAD_JSON = Uint8Array.of(0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d);

/** `ok<0xff>` — a page that is not UTF-8. */
const BAD_PAGE = Uint8Array.of(0x6f, 0x6b, 0xff);

/**
 * Answer every request with the given body bytes.
 * @param body - Response body.
 * @returns The fake, for request assertions.
 */
function serve(body: Uint8Array<ArrayBuffer> | string): IFetchFake {
  const fake = fakeFetch((): Response => new Response(body, { status: 200 }));
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
  strategy: HeadlessNativeFetchStrategy,
  opts: IFetchOpts,
): Promise<Procedure<unknown>> {
  return strategy.fetchGet<unknown>('portal?sid=secret', opts);
}

describe('NativeFetchStrategy — strict UTF-8 answers (N63)', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    ['json', JSON_CALL, BAD_JSON],
    ['document', DOCUMENT, BAD_PAGE],
    ['text', TEXT, BAD_PAGE],
  ])('refuses a %s answer that is not UTF-8, naming no body', async (_kind, opts, body) => {
    serve(body);
    const result = await getPortal(STRICT_BANK, opts);
    const expected = { success: false, errorType: ScraperErrorTypes.Generic };
    expect(result).toMatchObject({ ...expected, errorMessage: REFUSED });
  });

  it('reads valid UTF-8 and drops a leading BOM', async () => {
    const json = new TextEncoder().encode('\uFEFF{"name":"שלום"}');
    serve(json);
    const result = await getPortal(STRICT_BANK, JSON_CALL);
    expect(result).toEqual({ success: true, value: { name: 'שלום' } });
  });

  it('reads a valid UTF-8 document carrying its marker', async () => {
    serve('<main>portal-ready \u05e9\u05dc\u05d5\u05dd</main>');
    const opts = { ...DOCUMENT, documentMarker: 'portal-ready' };
    const result = await getPortal(STRICT_BANK, opts);
    expect(result).toEqual({ success: true, value: {} });
  });

  it('reads valid Unicode text under strict UTF-8', async () => {
    const text = '\u05e9\u05dc\u05d5\u05dd \u20ac \u{1F600}';
    serve(text);
    const result = await getPortal(STRICT_BANK, TEXT);
    expect(result).toEqual({ success: true, value: { text } });
  });

  it('reads a malformed byte as U+FFFD on a transport naming nothing', async () => {
    serve(BAD_JSON);
    const result = await getPortal(PLAIN, JSON_CALL);
    expect(result).toEqual({ success: true, value: { a: '\uFFFD' } });
  });

  it('lets a call opt out of the bank strict decoding', async () => {
    serve(BAD_PAGE);
    const result = await getPortal(STRICT_BANK, { ...DOCUMENT, strictUtf8: false });
    expect(result).toEqual({ success: true, value: {} });
  });

  it('lets a call decode strictly on a bank naming nothing', async () => {
    serve(BAD_PAGE);
    const result = await getPortal(PLAIN, { ...TEXT, strictUtf8: true });
    expect(result).toMatchObject({ success: false, errorMessage: REFUSED });
  });
});
