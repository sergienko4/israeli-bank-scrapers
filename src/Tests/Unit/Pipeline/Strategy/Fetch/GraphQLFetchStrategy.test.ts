/**
 * Unit tests for Strategy/Fetch/GraphQLFetchStrategy — transport-only.
 * Covers successful query, transport error propagation, malformed JSON,
 * variables verbatim in outbound body, Bearer propagation, and REUSE-CONTRACT
 * regex guard (no bank-name literals in source).
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { GraphQLFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

type MockFetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type MockFetch = jest.Mock<Promise<Response>, [string, RequestInit]>;

interface IFetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

const BANK_NAMES_REGEX =
  /oneZero|amex|isracard|hapoalim|discount|visaCal|max|beinleumi|massad|mercantile|otsarHahayal|pagi/i;

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const SOURCE_FILE_PATH = path.join(
  THIS_DIR,
  '../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.ts',
);

/**
 * Install a replacement for globalThis.fetch that delegates to impl.
 * @param impl - The mock implementation to drive fetch calls.
 * @returns The jest mock for call-capture assertions.
 */
function installFetchMock(impl: MockFetchImpl): MockFetch {
  const mock = jest.fn<Promise<Response>, [string, RequestInit]>(impl);
  (globalThis as unknown as { fetch: MockFetch }).fetch = mock;
  return mock;
}

/**
 * Build a fake Response with given status + body text.
 * @param status - HTTP status code to report.
 * @param bodyText - Raw body text returned by response.text().
 * @returns A Response-shaped object suitable for the mock fetch.
 */
function buildResponse(status: number, bodyText: string): Response {
  const isOkStatus = status >= 200 && status < 300;
  /**
   * Return the canned body text when fetch callers invoke response.text().
   * @returns Promise resolving to the canned body text.
   */
  const textFn = (): Promise<string> => Promise.resolve(bodyText);
  const responseLike = { ok: isOkStatus, status, text: textFn };
  return responseLike as unknown as Response;
}

/**
 * Build an impl that resolves with a prefabricated Response.
 * @param status - HTTP status code for the response.
 * @param bodyText - Body text to serve from the response.
 * @returns A MockFetchImpl that always resolves with the response.
 */
function respondWith(status: number, bodyText: string): MockFetchImpl {
  const response = buildResponse(status, bodyText);
  const promised = Promise.resolve(response);
  /**
   * Mock impl closure — ignores args and returns the canned response.
   * @returns The canned resolved Promise.
   */
  const impl: MockFetchImpl = () => promised;
  return impl;
}

/**
 * Build an impl that rejects with the given error on each call.
 * Freshly rejects each invocation to avoid unhandled-rejection warnings.
 * @param error - The error value to reject with.
 * @returns A MockFetchImpl that always rejects with the error.
 */
function rejectWith(error: Error): MockFetchImpl {
  /**
   * Mock impl closure — returns a fresh rejected Promise each call.
   * @returns A new rejected Promise wrapping the same error.
   */
  const impl: MockFetchImpl = () => Promise.reject(error);
  return impl;
}

/**
 * Extract the first captured fetch call.
 * @param mock - The jest mock to read from.
 * @returns Structured { url, init } of the first recorded call.
 */
function firstCall(mock: MockFetch): IFetchCall {
  const capturedCall = mock.mock.calls[0];
  return { url: capturedCall[0], init: capturedCall[1] };
}

/**
 * Parse the JSON body string back into a record.
 * @param init - The captured RequestInit whose body is inspected.
 * @returns Parsed record representation of the JSON body.
 */
function parseBody(init: RequestInit): Record<string, unknown> {
  const body = init.body as string;
  return JSON.parse(body) as Record<string, unknown>;
}

describe('GraphQLFetchStrategy.query — transport behaviour', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns succeed(parsed) on HTTP 200 with valid JSON body', async () => {
    const impl = respondWith(200, '{"data":{"hello":"world"}}');
    installFetchMock(impl);
    const strategy = new GraphQLFetchStrategy('https://gql.example/graphql');
    const result = await strategy.query<{ data: { hello: string } }>('query { hello }', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) {
      expect(result.value.data.hello).toBe('world');
    }
  });

  it('POSTs {query, variables} verbatim to the base URL', async () => {
    const impl = respondWith(200, '{"data":{}}');
    const fetchMock = installFetchMock(impl);
    const strategy = new GraphQLFetchStrategy('https://gql.example/graphql');
    const variables = { id: 'portfolio-a7f4b2c8', limit: 50 };
    const result = await strategy.query('query Q($id:ID!){ x(id:$id) }', variables);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    const capturedCall = firstCall(fetchMock);
    expect(capturedCall.url).toBe('https://gql.example/graphql');
    expect(capturedCall.init.method).toBe('POST');
    const parsedBody = parseBody(capturedCall.init);
    expect(parsedBody.query).toBe('query Q($id:ID!){ x(id:$id) }');
    expect(parsedBody.variables).toEqual(variables);
  });

  it('forwards Bearer in opts.extraHeaders to the outbound request', async () => {
    const impl = respondWith(200, '{"data":{}}');
    const fetchMock = installFetchMock(impl);
    const strategy = new GraphQLFetchStrategy('https://gql.example/graphql');
    const opts = { extraHeaders: { Authorization: 'Bearer a7f4b2c8d3e9' } };
    const result = await strategy.query('{ x }', {}, opts);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    const capturedCall = firstCall(fetchMock);
    const headers = capturedCall.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer a7f4b2c8d3e9');
  });

  it('propagates transport failure (fetch throws) as fail — not silently swallowed', async () => {
    const impl = rejectWith(new Error('socket hang up'));
    installFetchMock(impl);
    const strategy = new GraphQLFetchStrategy('https://gql.example/graphql');
    const result = await strategy.query('{ x }', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('network error');
      expect(result.errorMessage).toContain('socket hang up');
    }
  });

  it('returns fail with "parse error" on malformed JSON body', async () => {
    const impl = respondWith(200, '{not valid json');
    installFetchMock(impl);
    const strategy = new GraphQLFetchStrategy('https://gql.example/graphql');
    const result = await strategy.query('{ x }', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('parse error');
    }
  });
});

describe('GraphQLFetchStrategy source — REUSE-CONTRACT regex guard', () => {
  it('source file contains no bank-name literal (drift detector)', () => {
    const source = readFileSync(SOURCE_FILE_PATH, 'utf8');
    const hasBankName = BANK_NAMES_REGEX.test(source);
    expect(hasBankName).toBe(false);
  });
});
