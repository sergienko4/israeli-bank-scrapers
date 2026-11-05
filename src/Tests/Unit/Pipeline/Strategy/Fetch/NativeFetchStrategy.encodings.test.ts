/**
 * N23 — the native transport writes `form-latin1` and `text` POST bodies and
 * reads a `text` answer. A latin1 form encodes like Java's URLEncoder over
 * ISO-8859-1 and refuses a char above U+00FF before any request; a `text`
 * body travels verbatim with no content-type; a `text` answer reaches the
 * caller as `{ text }`, up to 65 536 chars.
 */

import { once } from 'node:events';
import { createServer } from 'node:http';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IFetchOpts } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import { fakeFetch, type IFetchFake } from '../../../../Helpers/FakeFetch.js';

const BASE_URL = 'https://api.bank.example/v1/';
const STRATEGY = new HeadlessNativeFetchStrategy(BASE_URL);
const LATIN1: IFetchOpts = { extraHeaders: {}, bodyEncoding: 'form-latin1' };
const TEXT_BODY: IFetchOpts = { extraHeaders: {}, bodyEncoding: 'text' };
const TEXT_ANSWER: IFetchOpts = { extraHeaders: {}, responseKind: 'text' };
const LATIN1_TYPE = 'application/x-www-form-urlencoded; charset=ISO-8859-1';
const TEXT_CAP = 65_536;

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
 * Answer every request with an empty JSON object.
 * @returns The fake, for request assertions.
 */
function serveJson(): IFetchFake {
  const response = Response.json({});
  return serve(response);
}

/**
 * The headers of the first request the fake saw, as a plain record.
 * @param fake - Fetch fake.
 * @returns Request headers.
 */
function sentHeaders(fake: IFetchFake): Record<string, string> {
  return fake.calls[0].init.headers as Record<string, string>;
}

describe('NativeFetchStrategy — N23 body encodings and text answers', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    ['a b*~ç', 'a+b*%7E%E7'],
    ['Az09.-*_', 'Az09.-*_'],
    ["&=+%/'!()", '%26%3D%2B%25%2F%27%21%28%29'],
    ['ÿ\u0080', '%FF%80'],
  ])('encodes %s like URLEncoder over ISO-8859-1', async (value, encoded) => {
    const fake = serveJson();
    await STRATEGY.fetchPost('login', { 'k y': value }, LATIN1);
    expect(fake.calls[0].init.body).toBe(`k+y=${encoded}`);
  });

  it('names ISO-8859-1 in place of a caller JSON content-type', async () => {
    const fake = serveJson();
    const extraHeaders = { 'Content-Type': 'application/json', 'x-trace': 't' };
    await STRATEGY.fetchPost('login', { a: '1', b: 2 }, { ...LATIN1, extraHeaders });
    expect(fake.calls[0].init.body).toBe('a=1&b=2');
    const headers = sentHeaders(fake);
    expect(headers).toEqual({ 'content-type': LATIN1_TYPE, 'x-trace': 't' });
  });

  it('refuses a char above U+00FF before any request, naming no value', async () => {
    const fake = serveJson();
    const result = await STRATEGY.fetchPost('login?sid=s', { password: 'p€ss' }, LATIN1);
    const expected = { errorType: ScraperErrorTypes.Generic };
    expect(result).toMatchObject({ success: false, ...expected });
    expect(result).toMatchObject({ errorMessage: `POST ${BASE_URL}login form-latin1 unencodable` });
    expect(fake.calls).toHaveLength(0);
  });

  it('sends a text body verbatim with no content-type', async () => {
    const fake = serveJson();
    const extraHeaders = { 'Content-Type': 'application/json', accept: '*/*' };
    const text = 'MIIC_x-y€';
    await STRATEGY.fetchPost('register', { text }, { ...TEXT_BODY, extraHeaders });
    const bytes = new TextEncoder().encode(text);
    expect(fake.calls[0].init.body).toEqual(bytes);
    const headers = sentHeaders(fake);
    expect(headers).toEqual({ accept: '*/*' });
  });

  it('sends text bytes without a Content-Type on the native wire', async () => {
    const received: { body: string; contentType?: string }[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: request.headers['content-type'],
        });
        response.setHeader('content-type', 'application/json');
        response.end('{}');
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new ScraperError('test server not bound');
      }
      const baseUrl = `http://127.0.0.1:${String(address.port)}/`;
      const strategy = new HeadlessNativeFetchStrategy(baseUrl);
      const text = 'MIIC_x-y€';
      const options = { ...TEXT_BODY, extraHeaders: { 'Content-Type': 'application/json' } };
      const result = await strategy.fetchPost('register', { text }, options);
      expect(result).toEqual({ success: true, value: {} });
      expect(received).toEqual([{ body: text, contentType: undefined }]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it.each([
    ['a number', { text: 5 }],
    ['an extra field', { text: 'a', more: 'b' }],
    ['no text field', { body: 'a' }],
  ])('refuses a text body with %s before any request', async (_label, data) => {
    const fake = serveJson();
    const result = await STRATEGY.fetchPost('register', data, TEXT_BODY);
    const message = `POST ${BASE_URL}register text body not a string`;
    expect(result).toMatchObject({ success: false, errorMessage: message });
    expect(fake.calls).toHaveLength(0);
  });

  it('hands a text answer over as { text }', async () => {
    serve(new Response('-----BEGIN CERTIFICATE-----\nAB\n', { status: 200 }));
    const result = await STRATEGY.fetchPost('register', { a: '1' }, TEXT_ANSWER);
    const value = { text: '-----BEGIN CERTIFICATE-----\nAB\n' };
    expect(result).toEqual({ success: true, value });
  });

  it('accepts a text answer at the cap', async () => {
    const text = 'a'.repeat(TEXT_CAP);
    serve(new Response(text, { status: 200 }));
    const result = await STRATEGY.fetchGet('cert', TEXT_ANSWER);
    expect(result).toEqual({ success: true, value: { text } });
  });

  it('refuses a text answer one char over the cap', async () => {
    const text = 'a'.repeat(TEXT_CAP + 1);
    serve(new Response(text, { status: 200 }));
    const result = await STRATEGY.fetchGet('cert?sid=s', TEXT_ANSWER);
    const message = `GET ${BASE_URL}cert text too long`;
    expect(result).toMatchObject({ success: false, errorMessage: message });
  });
});
