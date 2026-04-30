/**
 * Unit tests for BrowserFetchStrategy.activateSession — branch matrix.
 * Split from BrowserFetchStrategy.test.ts to honor max-lines=300.
 */

import type { Page } from 'playwright-core';

import { createBrowserFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/BrowserFetchStrategy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Build TestError with message.
   * @param message - Error message.
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

/** Scripted response for a mocked page.evaluate (POST/GET). */
type EvalTuple = readonly [string, number];

/**
 * Build a Page whose evaluate returns scripted tuples in order, then throws.
 * @param tuples - Responses to return in order.
 * @param urlValue - page.url() return.
 * @returns Scripted Page.
 */
function makeScriptedPage(tuples: readonly EvalTuple[], urlValue = 'https://api.example/'): Page {
  let idx = 0;
  return {
    /**
     * Page URL stub.
     * @returns Configured URL.
     */
    url: (): string => urlValue,
    /**
     * Frames stub.
     * @returns Empty frames.
     */
    frames: (): Page[] => [],
    /**
     * Evaluate stub — returns scripted tuples in order.
     * @returns Scripted tuple or rejection when exhausted.
     */
    evaluate: (): Promise<EvalTuple> => {
      if (idx >= tuples.length) return Promise.reject(new Error('no-more-scripted-responses'));
      const current = tuples[idx];
      idx += 1;
      return Promise.resolve(current);
    },
  } as unknown as Page;
}

/**
 * Build a minimal non-scripted Page — url() only.
 * @returns Stub Page.
 */
function makePage(): Page {
  return {
    /**
     * Page URL stub.
     * @returns Bank homepage URL.
     */
    url: (): string => 'https://bank.example.com/',
    /**
     * Frames stub.
     * @returns Empty frames.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

describe('BrowserFetchStrategy.activateSession — branch matrix', () => {
  it('fails when ValidateIdData returns bad status', async () => {
    const page = makeScriptedPage([[JSON.stringify({ Header: { Status: '0' } }), 200]]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
      auth: { companyCode: 'XX' },
    } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      { username: 'u', password: 'p', id: '1', card6Digits: '2' },
      config,
    );
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(false);
  });

  it('fails when ValidateIdData returns unparseable response', async () => {
    const page = makeScriptedPage([['not-json', 200]]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      { username: '', password: '', id: '', card6Digits: '' },
      config,
    );
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(false);
  });

  it('fails when performLogon fetch returns null', async () => {
    const validateOk = JSON.stringify({
      Header: { Status: '1' },
      ValidateIdDataBean: { userName: 'u' },
    });
    const page = makeScriptedPage([
      [validateOk, 200],
      ['bad-json{{', 400],
    ]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      { username: 'u', password: 'p', id: '1', card6Digits: '2' },
      config,
    );
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(false);
  });

  it('handles missing ValidateIdDataBean (optional-chain branch)', async () => {
    const page = makeScriptedPage([
      [JSON.stringify({ Header: { Status: '1' } }), 200],
      [JSON.stringify({ ok: true }), 200],
    ]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      { username: 'u', password: 'p', id: '', card6Digits: '' },
      config,
    );
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });

  it('handles empty credentials via absentCredential branches', async () => {
    const page = makeScriptedPage([
      [JSON.stringify({ Header: { Status: '1' }, ValidateIdDataBean: { userName: '' } }), 200],
      [JSON.stringify({ ok: true }), 200],
    ]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      { username: '', password: '', id: '', card6Digits: '' },
      config,
    );
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(true);
  });

  it('respects discovered services URL over config.api.base', async () => {
    const page = makeScriptedPage([[JSON.stringify({ Header: { Status: '0' } }), 200]]);
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      { username: 'u', password: 'p', id: '1', card6Digits: '2' },
      config,
      'https://override.example/services/ProxyRequestHandler.ashx',
    );
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(false);
  });

  it('fails when relative services URL is passed (starts with /)', async () => {
    const page = makePage();
    const strategy = createBrowserFetchStrategy(page);
    const config = { urls: { base: 'https://b.example' } } as unknown as BankConfigStub;
    if (!strategy.activateSession) throw new TestError('activateSession missing');
    const result = await strategy.activateSession(
      { username: 'u', password: 'p' },
      config,
      '/relative/path',
    );
    const isOkResult16 = isOk(result);
    expect(isOkResult16).toBe(false);
  });
});
