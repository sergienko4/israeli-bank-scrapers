/**
 * A call naming `bodyEncoding: 'form'` sends its flat record as an
 * `application/x-www-form-urlencoded` body in key order; a call naming none
 * still sends JSON exactly as before.
 */

import type { IFetchOpts } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { cappedNative } from '../../../../Helpers/CappedTransport.js';
import { fakeFetch, type IFetchFake } from '../../../../Helpers/FakeFetch.js';

const BASE_URL = 'https://api.bank.example/v1/';
const STRATEGY = cappedNative(BASE_URL);
const FORM: IFetchOpts = { extraHeaders: {}, bodyEncoding: 'form' };
const FORM_TYPE = 'application/x-www-form-urlencoded';

/**
 * Answer every request with an empty JSON object.
 * @returns The fake, for request assertions.
 */
function serveEmpty(): IFetchFake {
  const fake = fakeFetch((): Response => Response.json({}));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * The headers of the first request the fake saw, as a plain record.
 * @param fake - Fetch fake.
 * @returns Request headers.
 */
function sentHeaders(fake: IFetchFake): Record<string, string> {
  return fake.calls[0].init.headers as Record<string, string>;
}

describe('NativeFetchStrategy — form bodies', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('sends a flat record form-encoded, in key order', async () => {
    const fake = serveEmpty();
    const data = { user: 'syn user', n: '7', tag: 'a&b=c' };
    await STRATEGY.fetchPost('login', data, FORM);
    expect(fake.calls[0].init.body).toBe('user=syn+user&n=7&tag=a%26b%3Dc');
    expect(sentHeaders(fake)['content-type']).toBe(FORM_TYPE);
  });

  it('replaces a caller JSON content-type on a form call', async () => {
    const fake = serveEmpty();
    const extraHeaders = { 'Content-Type': 'application/json', 'x-trace': 't' };
    await STRATEGY.fetchPost('login', { a: '1' }, { ...FORM, extraHeaders });
    const headers = sentHeaders(fake);
    expect(headers).toEqual({ 'content-type': FORM_TYPE, 'x-trace': 't' });
  });

  it('keeps JSON calls unchanged', async () => {
    const fake = serveEmpty();
    await STRATEGY.fetchPost('login', { a: '1' }, { extraHeaders: {} });
    expect(fake.calls[0].init.body).toBe('{"a":"1"}');
    expect(sentHeaders(fake)['content-type']).toBe('application/json');
  });

  it.each([
    ['a top-level array', [{ id: 'syn-account-1' }]],
    ['a nested record', { auth: { session: 'syn-session' } }],
    ['an array value', { accounts: ['syn-account-1'] }],
    ['a null value', { auth: null }],
    ['a non-finite number', { limit: Number.POSITIVE_INFINITY }],
  ])('rejects %s before sending a form', async (_label, data) => {
    const fake = serveEmpty();
    const result = await STRATEGY.fetchPost('login', data, FORM);
    const errorMessage = `POST ${BASE_URL}login form body not flat`;
    expect(result).toMatchObject({ success: false, errorMessage });
    expect(fake.calls).toHaveLength(0);
  });
});
