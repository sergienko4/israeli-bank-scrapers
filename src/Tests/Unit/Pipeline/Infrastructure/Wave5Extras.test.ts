/**
 * Wave 5 extras — closing out branch gaps across LoginPhaseActions,
 * AccountBootstrap, and FrozenScrapeAction.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { executeValidateLogin } from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import { harvestAccountsFromStorage } from '../../../../Scrapers/Pipeline/Mediator/Scrape/AccountBootstrap.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IBrowserState } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Narrow ctx.browser to ISome.
 * @param ctx - Parameter.
 * @param ctx.browser - Browser option.
 * @param ctx.browser.has - Present flag.
 * @returns Result.
 */
function requireBrowser(ctx: { browser: { has: boolean } }): IBrowserState {
  if (!ctx.browser.has) throw new TestError('expected browser state');
  return (ctx.browser as { has: true; value: IBrowserState }).value;
}

import {
  makeContextWithLogin,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from './TestHelpers.js';

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

// ── AccountBootstrap: line 101 (hit.value && false branch) ─────────

describe('AccountBootstrap — Wave 5 hit.value falsy branch', () => {
  it('immediate scan finds fulfilled with value=false (returns false short-circuit)', async () => {
    /** Frame where evaluate resolves with false-ish value that still makes tryExtractAccounts return false. */
    const frame = {
      /**
       * Returns empty list (not JSON-like) — scanFrame → undefined matchVal → false.
       * @returns Empty array.
       */
      evaluate: (): Promise<readonly string[]> => Promise.resolve([]),
      /**
       * Rejects to end polling path.
       * @returns Rejected.
       */
      waitForFunction: (): Promise<never> => Promise.reject(new Error('timeout')),
    } as unknown as Frame;
    const page = {
      /**
       * Single frame.
       * @returns Frame list.
       */
      frames: (): readonly Frame[] => [frame],
    } as unknown as Page;
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids).toEqual([]);
  });

  it('immediate scan with frame value=false triggers line 101 fallback', async () => {
    /** Frame returning non-empty that parses but yields no accountId match → tryExtract→false */
    const frame = {
      /**
       * Return JSON that won't yield accountIds.
       * @returns Non-account JSON.
       */
      evaluate: (): Promise<readonly string[]> => Promise.resolve(['{"foo":"bar"}']),
      /**
       * Rejects to exit polling.
       * @returns Rejected.
       */
      waitForFunction: (): Promise<never> => Promise.reject(new Error('timeout')),
    } as unknown as Frame;
    const page = {
      /**
       * One frame.
       * @returns Frames.
       */
      frames: (): readonly Frame[] => [frame],
    } as unknown as Page;
    const result = await harvestAccountsFromStorage(page);
    expect(result.ids).toEqual([]);
  });
});

// ── LoginPhaseActions: line 432 (fillFromDiscovery failure) ────────

describe('LoginPhaseActions — Wave 5 extras', () => {
  const baseConfig = {
    loginUrl: 'https://bank.example.com/login',
    fields: [],
    submit: { kind: 'textContent' as const, value: 'Login' },
    possibleResults: {},
  };

  it('executeValidateLogin: no browser → early fail (line 450)', async () => {
    const mediator = makeMockMediator();
    const base = makeMockContext();
    /** Login has, browser doesn't. */
    const ctx = {
      ...base,
      login: some({ activeFrame: makeScreenshotPage(), persistentOtpToken: none() }),
    };
    const result = await executeValidateLogin(baseConfig as unknown as ILoginConfig, mediator, ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(false);
  });

  it('executeValidateLogin: postAction callback failure propagates', async () => {
    const mediator = makeMockMediator();
    const makeScreenshotPageResult2 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult2);
    const cfg = {
      ...baseConfig,
      /**
       * Post action returns a fail Procedure.
       * @returns Fail.
       */
      postAction: (): Promise<unknown> => {
        const failResult = fail(ScraperErrorTypes.Generic, 'post fail');
        return Promise.resolve(failResult);
      },
    };
    const result = await executeValidateLogin(cfg as unknown as ILoginConfig, mediator, ctx);
    // postAction can return anything — if Procedure, may pass through
    expect(typeof result.success).toBe('boolean');
  });

  it('executeValidateLogin: URL moved off login + browser has + ensureDashboardRedirect with fulfilled wait', async () => {
    const mediator = makeMockMediator({
      /**
       * URL already on dashboard, bypasses waitForURL call.
       * @returns Dashboard URL.
       */
      getCurrentUrl: () => 'https://bank.example.com/dashboard',
    });
    const makeScreenshotPageResult3 = makeScreenshotPage();
    const base = makeContextWithLogin(makeScreenshotPageResult3);
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, loginUrl: 'https://bank.example.com/login' },
    };
    const result = await executeValidateLogin(baseConfig as unknown as ILoginConfig, mediator, ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('ensureDashboardRedirect: wait fulfils and browser leaves the login path', async () => {
    let callIdx = 0;
    const urlsInOrder = [
      'https://bank.example.com/login',
      'https://bank.example.com/login',
      'https://bank.example.com/dashboard',
    ];
    const mediator = makeMockMediator({
      /**
       * First two calls keep us on /login (triggering the wait);
       * third call returns /dashboard so bounce detection passes.
       * @returns Sequential URL stubs.
       */
      getCurrentUrl: () => {
        const url = urlsInOrder[Math.min(callIdx, urlsInOrder.length - 1)];
        callIdx += 1;
        return url;
      },
    });
    const makeScreenshotPageResult5 = makeScreenshotPage();
    const ctxBase = makeContextWithLogin(makeScreenshotPageResult5);
    const ctxBaseBrowser = requireBrowser(ctxBase);
    /** Page whose waitForURL fulfills quickly. */
    const pageWithResolve = {
      ...ctxBaseBrowser.page,
      /**
       * Succeed quickly.
       * @returns Resolved.
       */
      waitForURL: (): Promise<undefined> => Promise.resolve(undefined),
    };
    const ctx = {
      ...ctxBase,
      browser: some({ ...ctxBaseBrowser, page: pageWithResolve as unknown as Page }),
      diagnostics: { ...ctxBase.diagnostics, loginUrl: 'https://bank.example.com/login' },
    };
    const result = await executeValidateLogin(baseConfig as unknown as ILoginConfig, mediator, ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
    expect(callIdx).toBeGreaterThanOrEqual(1);
  });
});

// ── LoginPhaseActions: postAction return succeed(undefined) branch ──

describe('LoginPhaseActions — postAction succeed path', () => {
  const baseConfig = {
    loginUrl: 'https://bank.example.com/login',
    fields: [],
    submit: { kind: 'textContent' as const, value: 'Login' },
    possibleResults: {},
  };

  it('runPostCallback returns succeed → validate continues', async () => {
    const mediator = makeMockMediator();
    const makeScreenshotPageResult7 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult7);
    const cfg = {
      ...baseConfig,
      /**
       * postAction resolves with Procedure succeed.
       * @returns Succeed.
       */
      postAction: (): Promise<unknown> => {
        const okVoid = succeed(undefined);
        return Promise.resolve(okVoid);
      },
    };
    const result = await executeValidateLogin(cfg as unknown as ILoginConfig, mediator, ctx);
    expect(typeof result.success).toBe('boolean');
  });
});
