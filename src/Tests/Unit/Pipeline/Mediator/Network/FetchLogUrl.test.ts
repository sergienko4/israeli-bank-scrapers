/**
 * Log-safety oracle for the URL every Mediator fetch names in its log lines.
 *
 * A bank URL carries an account in its path and tokens or device ids in its
 * query — under keys no allow-list can name. Every line a fetch logs about its
 * request must keep origin + path, with id-shaped path segments masked and no
 * query value at all.
 */

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { ECHO_QUERY, leakedSecretsIn } from '../../../../Helpers/UrlEchoFixtures.js';
import { createDebugMock } from '../../../../MockModuleFactories.js';

const DEBUG_SPY = jest.fn();
const MOCK_LOGGER = { debug: DEBUG_SPY, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const GET_DEBUG = jest.fn();
GET_DEBUG.mockReturnValue(MOCK_LOGGER);

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', () => ({
  ...createDebugMock(),
  getDebug: GET_DEBUG,
}));

const FETCH = await import('../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/index.js');

const REAL_FETCH = globalThis.fetch;

/** Synthetic account digits that must never reach a log. */
const ACCOUNT = '1234567890';

/** A request URL with an account in the path and secrets in the query. */
const REQUEST_URL = `https://bank.co.il/api/accounts/${ACCOUNT}${ECHO_QUERY}`;

/** The account as the log may name it: last four only. */
const ACCOUNT_HINT = '***7890';

/**
 * A page whose in-page fetch answers with a fixed status and JSON body.
 * @param status - HTTP status the in-page fetch reports.
 * @returns Fake page.
 */
function makePage(status: number): Page {
  /**
   * Resolve the evaluator tuple without running the in-page body.
   * @returns The response tuple.
   */
  const evaluate = (): Promise<unknown> =>
    Promise.resolve(['{"ok":true}', status, 'application/json', false, REQUEST_URL]);
  return { evaluate } as unknown as Page;
}

/**
 * Answer every native fetch with a 200 JSON body.
 * @returns The stub response.
 */
function respondOk(): Promise<Response> {
  const response = new Response('{"ok":true}', { status: 200 });
  return Promise.resolve(response);
}

/**
 * Serialise every debug call recorded so far.
 * @returns All debug records joined by newlines.
 */
function debugLines(): string {
  const records = DEBUG_SPY.mock.calls.map((call): string => JSON.stringify(call));
  return records.join('\n');
}

/**
 * In-page GET answered 200.
 * @returns The fetch result.
 */
function pageGet(): Promise<unknown> {
  const page = makePage(200);
  return FETCH.fetchGetWithinPage(page, REQUEST_URL);
}

/**
 * In-page GET with extra headers answered 200.
 * @returns The fetch result.
 */
function pageGetWithHeaders(): Promise<unknown> {
  const page = makePage(200);
  return FETCH.fetchGetWithinPageWithHeaders(page, REQUEST_URL, {});
}

/**
 * In-page GET answered 503, so the non-200 line is logged too.
 * @returns The fetch result.
 */
function pageGetUnavailable(): Promise<unknown> {
  const page = makePage(503);
  return FETCH.fetchGetWithinPage(page, REQUEST_URL, true);
}

/**
 * In-page POST answered 200.
 * @returns The fetch result.
 */
function pagePost(): Promise<unknown> {
  const page = makePage(200);
  return FETCH.fetchPostWithinPage(page, REQUEST_URL, { data: {} });
}

/**
 * Native GET answered 200.
 * @returns The fetch result.
 */
function nativeGet(): Promise<unknown> {
  return FETCH.fetchGet(REQUEST_URL, {});
}

/**
 * Native POST answered 200.
 * @returns The fetch result.
 */
function nativePost(): Promise<unknown> {
  return FETCH.fetchPost(REQUEST_URL, {});
}

/** Every Mediator fetch entry point, driven against {@link REQUEST_URL}. */
const CARRIERS = [
  { label: 'in-page GET', run: pageGet },
  { label: 'in-page GET with headers', run: pageGetWithHeaders },
  { label: 'in-page GET answered 503', run: pageGetUnavailable },
  { label: 'in-page POST', run: pagePost },
  { label: 'native GET', run: nativeGet },
  { label: 'native POST', run: nativePost },
] as const;

describe('Mediator fetch log lines — oracle: the request URL leaks nothing', () => {
  beforeEach(() => {
    DEBUG_SPY.mockClear();
    globalThis.fetch = jest.fn(respondOk);
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
  });

  it.each(CARRIERS)('$label logs no query value and no full account', async ({ run }) => {
    await run();
    const logged = debugLines();
    const leaked = leakedSecretsIn(logged);
    expect(logged).toContain(ACCOUNT_HINT);
    expect(logged).not.toContain(ACCOUNT);
    expect(leaked).toEqual([]);
  });
});
