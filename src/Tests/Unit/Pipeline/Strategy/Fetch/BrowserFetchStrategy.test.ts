/**
 * Unit tests for BrowserFetchStrategy — factory + proxyGet guard path.
 */

import type { Page } from 'playwright-core';

import type { ScraperCredentials } from '../../../../../Scrapers/Base/Interface.js';
import { createBrowserFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/BrowserFetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Test helper.
   *
   * @param message - Parameter.
   * @returns Result.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/** Bank config type pulled via IFetchStrategy parameter shape. */
type BankConfigStub = Parameters<
  NonNullable<ReturnType<typeof createBrowserFetchStrategy>['proxyGet']>
>[0];

/**
 * Minimal stub Page — url() only; other methods unused in these tests.
 * @param urlValue - URL to report.
 * @returns Stub Page.
 */
function makePage(urlValue = 'https://bank.example.com/'): Page {
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    url: (): string => urlValue,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

describe('createBrowserFetchStrategy', () => {
  it('returns an IFetchStrategy with fetchPost/fetchGet', () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    expect(typeof strategy.fetchPost).toBe('function');
    expect(typeof strategy.fetchGet).toBe('function');
  });

  it('exposes activateSession hook', () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    expect(typeof strategy.activateSession).toBe('function');
  });

  it('exposes proxyGet hook', () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    expect(typeof strategy.proxyGet).toBe('function');
  });
});

describe('BrowserFetchStrategy.proxyGet', () => {
  it('fails when config has no api.base', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    const config = { urls: { base: 'https://b.example' } } as unknown as BankConfigStub;
    if (!strategy.proxyGet) throw new TestError('proxyGet missing');
    const result = await strategy.proxyGet(config, 'anyReq', {});
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(false);
  });
});

describe('BrowserFetchStrategy.activateSession', () => {
  it('fails when no servicesUrl can be resolved', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    const config = { urls: { base: 'https://b.example' } } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession({ username: 'u', password: 'p' }, config);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(false);
  });
});

/** Use DEFAULT_FETCH_OPTS to touch the interface type at runtime. */
describe('BrowserFetchStrategy types', () => {
  it('DEFAULT_FETCH_OPTS is shaped like IFetchOpts', () => {
    expect(DEFAULT_FETCH_OPTS).toHaveProperty('extraHeaders');
  });
});

describe('BrowserFetchStrategy.fetchPost (error branch)', () => {
  it('returns failure when underlying fetch throws', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    // No fetchPostWithinPage handler is wired up in the mock page,
    // so the call will reject internally and land in catchError.
    const result = await strategy.fetchPost(
      'https://bank.example.com/api',
      { foo: 'bar' },
      { extraHeaders: {} },
    );
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
  });
});

describe('BrowserFetchStrategy.fetchGet (error branch)', () => {
  it('returns failure when underlying fetch throws (no headers)', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://bank.example.com/api', {
      extraHeaders: {},
    });
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(false);
  });

  it('returns failure when underlying fetch throws (with headers)', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://bank.example.com/api', {
      extraHeaders: { 'X-Auth': 't' },
    });
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(false);
  });
});

describe('BrowserFetchStrategy.activateSession (proxy path)', () => {
  it('constructs services URL from api.base when no discovered URL', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession({ username: 'u', password: 'p' }, config);
    // ValidateIdData fetch will fail due to no page network mocking → returns fail
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(false);
  });

  it('uses provided discoveredServicesUrl when passed', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    const config = { urls: { base: 'https://b.example' } } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      {
        username: 'u',
        password: 'p',
        id: '111',
        card6Digits: '222',
      } as unknown as ScraperCredentials,
      config,
      'https://discovered.example/services/ProxyRequestHandler.ashx',
    );
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(false);
  });
});

describe('BrowserFetchStrategy.proxyGet (with api.base)', () => {
  it('attempts fetch and returns failure when underlying fetch throws', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.proxyGet) throw new TestError('proxyGet missing');
    const result = await strategy.proxyGet(config, 'ReqX', { k: 'v' });
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(false);
  });
});

// ---- Deep-branch extensions (Wave 4 / Agent J) ----

/** Scripted response for a mocked page.evaluate (POST/GET). */
type EvalTuple = readonly [string, number];

/**
 * Build a Page whose evaluate returns scripted tuples in order, then throws.
 * Covers the POST/GET branches inside fetchPostWithinPage / fetchGetWithinPage.
 * @param tuples - Responses to return in order.
 * @param urlValue - page.url() return.
 * @param frames - Frames to expose via page.frames().
 * @returns Scripted Page.
 */
function makeScriptedPage(
  tuples: readonly EvalTuple[],
  urlValue = 'https://api.example/',
  frames: Page[] = [],
): Page {
  let idx = 0;
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    url: (): string => urlValue,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    frames: (): Page[] => frames,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    evaluate: (): Promise<EvalTuple> => {
      if (idx >= tuples.length) return Promise.reject(new Error('no-more-scripted-responses'));
      const current = tuples[idx];
      idx += 1;
      return Promise.resolve(current);
    },
  } as unknown as Page;
}

describe('BrowserFetchStrategy — resolveAuthFields defaults × overrides', () => {
  /** Name, auth partial, and the field expected to be applied. */
  const cases = [
    ['no auth object at all (uses all defaults)', undefined],
    ['auth={} minimal', {}],
    ['auth override countryCode', { countryCode: '999' }],
    ['auth override idType', { idType: '9' }],
    ['auth override checkLevel', { checkLevel: '9' }],
    ['auth override loginReqName', { loginReqName: 'myLogin' }],
    ['auth override companyCode', { companyCode: 'MYCO' }],
    [
      'auth override all fields',
      {
        countryCode: '200',
        idType: '2',
        checkLevel: '3',
        loginReqName: 'performLogonX',
        companyCode: 'ZZ',
      },
    ],
  ] as const;
  it.each(cases)('activateSession runs with %s', async (_label, authPartial) => {
    // Script 2 evaluates: first = ValidateIdData success, second = performLogon success.
    const ok = JSON.stringify({ Header: { Status: '1' }, ValidateIdDataBean: { userName: 'u' } });
    const page = makeScriptedPage([
      [ok, 200],
      [JSON.stringify({ ok: true }), 200],
    ]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
      auth: authPartial,
    } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      { username: 'u', password: 'p', id: '1', card6Digits: '2' } as unknown as ScraperCredentials,
      config,
    );
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });
});
