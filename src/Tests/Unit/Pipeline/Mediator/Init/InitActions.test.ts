/**
 * Unit tests for InitActions — navigation, validate, wire helpers.
 */

import type { BrowserContext, Page } from 'playwright-core';

import {
  executeNavigateToBank,
  executeValidatePage,
  executeWireComponents,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/InitActions.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/**
 * Build a mock Page with scripted goto/title/url.
 * @param script - Behaviour.
 * @param script.url - Script URL.
 * @param script.title - Script title.
 * @param script.gotoThrows - Whether goto throws.
 * @param script.titleThrows - Whether title throws.
 * @returns Mock Page.
 */
function makePage(script: {
  url?: string;
  title?: string;
  gotoThrows?: boolean;
  titleThrows?: boolean;
}): Page {
  let currentUrl = script.url ?? 'https://bank.co.il';
  const self = {
    /**
     * url.
     * @returns Scripted URL.
     */
    url: (): string => currentUrl,
    /**
     * goto.
     * @param newUrl - Target URL.
     * @returns Scripted.
     */
    goto: (newUrl: string): Promise<boolean> => {
      if (script.gotoThrows) return Promise.reject(new Error('nav-fail'));
      currentUrl = newUrl;
      return Promise.resolve(true);
    },
    /**
     * title.
     * @returns Scripted title.
     */
    title: (): Promise<string> => {
      if (script.titleThrows) return Promise.reject(new Error('no title'));
      return Promise.resolve(script.title ?? 'Bank');
    },
    /**
     * on — no-op for createElementMediator's event listeners.
     * @returns Self.
     */
    on: (): Page => self as unknown as Page,
    /**
     * off — no-op.
     * @returns Self.
     */
    off: (): Page => self as unknown as Page,
    /**
     * frames — empty.
     * @returns Empty frames.
     */
    frames: (): Page[] => [],
    /**
     * waitForResponse — never resolves (fire-and-forget).
     * @returns Never-resolving promise.
     */
    waitForResponse: (): Promise<never> => Promise.race([]),
    /**
     * context — bag with on/off hooks.
     * @returns Self.
     */
    context: (): unknown => ({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      on: (): unknown => undefined,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      off: (): unknown => undefined,
    }),
  };
  return self as unknown as Page;
}

/**
 * Build a context with scripted page attached.
 * @param page - Mock page.
 * @returns Pipeline context with browser.
 */
function ctxWithPage(page: Page): IPipelineContext {
  const base = makeMockContext();
  return {
    ...base,
    browser: some({
      browser: {},
      context: {} as BrowserContext,
      page,
    } as unknown as IBrowserState),
  };
}

describe('executeNavigateToBank', () => {
  it('fails when no browser is available', async () => {
    const ctx = makeMockContext();
    const result = await executeNavigateToBank(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(false);
  });

  it('succeeds when goto resolves', async () => {
    const page = makePage({ url: 'https://bank.co.il' });
    const ctx = ctxWithPage(page);
    const result = await executeNavigateToBank(ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('fails when goto throws', async () => {
    const page = makePage({ gotoThrows: true });
    const ctx = ctxWithPage(page);
    const result = await executeNavigateToBank(ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('navigation failed');
  });
});

describe('executeValidatePage', () => {
  it('fails when no browser', async () => {
    const makeMockContextResult4 = makeMockContext();
    const result = await executeValidatePage(makeMockContextResult4);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(false);
  });

  it('succeeds when page URL is not about:blank', async () => {
    const page = makePage({ url: 'https://bank.co.il/login' });
    const ctxWithPageResult6 = ctxWithPage(page);
    const result = await executeValidatePage(ctxWithPageResult6);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('fails when page URL is about:blank', async () => {
    const page = makePage({ url: 'about:blank' });
    const ctxWithPageResult8 = ctxWithPage(page);
    const result = await executeValidatePage(ctxWithPageResult8);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(false);
  });

  it('gracefully handles title() rejection (uses empty string fallback)', async () => {
    const page = makePage({ url: 'https://bank.co.il', titleThrows: true });
    const ctxWithPageResult10 = ctxWithPage(page);
    const result = await executeValidatePage(ctxWithPageResult10);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });
});

describe('executeWireComponents', () => {
  it('fails when no browser', () => {
    const makeMockContextResult12 = makeMockContext();
    const result = executeWireComponents(makeMockContextResult12);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(false);
  });

  it('succeeds with mediator + fetchStrategy + loginUrl in diagnostics', () => {
    const page = makePage({ url: 'https://bank.co.il/login' });
    const ctxWithPageResult14 = ctxWithPage(page);
    const result = executeWireComponents(ctxWithPageResult14);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
    if (result.success) {
      expect(result.value.mediator.has).toBe(true);
      expect(result.value.fetchStrategy.has).toBe(true);
      expect(result.value.diagnostics.loginUrl).toBe('https://bank.co.il/login');
    }
  });
});

/**
 * Build an instrumented mock `BrowserContext` for cold-start
 * tests. Each method records its name into the shared log and
 * resolves successfully — the protocol's behaviour under partial
 * failures is covered by the inline `.catch()` handlers, not
 * by these unit tests.
 *
 * @param log - Mutable cleanup-call log, in call order.
 * @returns Mock context typed as `BrowserContext`.
 */
function makeColdStartContext(log: string[]): BrowserContext {
  const fakeContext = {
    /**
     * Record the cookies-clear call.
     * @returns Resolved void.
     */
    clearCookies: (): Promise<void> => {
      log.push('clearCookies');
      return Promise.resolve();
    },
    /**
     * Record the permissions-clear call.
     * @returns Resolved void.
     */
    clearPermissions: (): Promise<void> => {
      log.push('clearPermissions');
      return Promise.resolve();
    },
    /**
     * Record the addInitScript call (storage-clear hook).
     * @returns Resolved void.
     */
    addInitScript: (): Promise<void> => {
      log.push('addInitScript');
      return Promise.resolve();
    },
  };
  return fakeContext as unknown as BrowserContext;
}

/**
 * Cold-start protocol regression coverage — PR #215 round 4.
 *
 * <p>The protocol strips every client-side recognition signal so
 * device-remembered banks (Hapoalim) present the full OTP challenge.
 * Round 4 extended `clearCookies` to also clear localStorage,
 * sessionStorage, IndexedDB, and permissions. The tests below use
 * an instrumented mock `BrowserContext` that records every cleanup
 * call and asserts the protocol fires the expected channels in
 * the expected order. The init-script body itself runs in the
 * browser-side closure and is not exercised in Node — coverage
 * for that block is provided by live E2E runs with
 * `DUMP_SNAPSHOTS=1`.
 */
describe('coldStartIfDumping', () => {
  /** Capture the original env so each test starts from the same state. */
  const originalDumpFlag = process.env.DUMP_SNAPSHOTS;

  afterEach((): void => {
    if (originalDumpFlag === undefined) {
      delete process.env.DUMP_SNAPSHOTS;
    } else {
      process.env.DUMP_SNAPSHOTS = originalDumpFlag;
    }
  });

  it('CS-1 returns false and runs no cleanup when DUMP_SNAPSHOTS is unset', async () => {
    delete process.env.DUMP_SNAPSHOTS;
    const log: string[] = [];
    const context = makeColdStartContext(log);
    const { coldStartIfDumping } =
      await import('../../../../../Scrapers/Pipeline/Mediator/Init/InitActions.js');

    const wasFired = await coldStartIfDumping(context);

    expect(wasFired).toBe(false);
    expect(log.length).toBe(0);
  });

  it('CS-2 fires every cleanup channel when DUMP_SNAPSHOTS=1', async () => {
    process.env.DUMP_SNAPSHOTS = '1';
    const log: string[] = [];
    const context = makeColdStartContext(log);
    const { coldStartIfDumping } =
      await import('../../../../../Scrapers/Pipeline/Mediator/Init/InitActions.js');

    const wasFired = await coldStartIfDumping(context);

    expect(wasFired).toBe(true);
    const expected: readonly string[] = ['clearCookies', 'clearPermissions', 'addInitScript'];
    expect(log).toEqual(expected);
  });

  it('CS-3 also accepts DUMP_SNAPSHOTS="true"', async () => {
    process.env.DUMP_SNAPSHOTS = 'true';
    const log: string[] = [];
    const context = makeColdStartContext(log);
    const { coldStartIfDumping } =
      await import('../../../../../Scrapers/Pipeline/Mediator/Init/InitActions.js');

    const wasFired = await coldStartIfDumping(context);

    expect(wasFired).toBe(true);
    expect(log.length).toBe(3);
  });
});
