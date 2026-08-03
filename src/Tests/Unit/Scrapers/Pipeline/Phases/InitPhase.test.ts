/**
 * Unit tests for InitPhase.ts.
 * Mocks CamoufoxLauncher, Browser.buildContextOptions, CreateElementMediator.
 */

import { jest } from '@jest/globals';

import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
// Static imports of non-mocked factories — safe with jest.unstable_mockModule.
import { makeMockOptions } from '../../../Pipeline/Infrastructure/MockFactories.js';
import { makeMockContext as MAKE_MOCK_CONTEXT } from '../MockPipelineFactories.js';

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js',
  () => ({
    launchCamoufox: jest.fn(),
  }),
);

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.js',
  () => ({
    buildContextOptions: jest.fn().mockReturnValue({}),
    ISRAEL_LOCALE: 'he-IL',
    ISRAEL_TIMEZONE: 'Asia/Jerusalem',
  }),
);

/**
 * Ordered record of cleanup side effects, appended by the mocked session
 * store and the close stubs so the drain order is assertable.
 */
const CLEANUP_ORDER: string[] = [];

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserSessionStore.js',
  () => ({
    loadSessionState: jest.fn().mockReturnValue(false),
    isSessionEnabled: jest.fn().mockReturnValue(true),
    /**
     * Stand-in save that records when it ran relative to the closes.
     * @returns True — a session file was written.
     */
    saveSessionStateSafe: jest.fn((): Promise<boolean> => {
      CLEANUP_ORDER.push('save');
      return Promise.resolve(true);
    }),
  }),
);

/** Mock mediator shape for createElementMediator. */
const MOCK_MEDIATOR = {
  resolveField: jest.fn(),
  resolveClickable: jest.fn(),
  discoverErrors: jest.fn(),
  waitForLoadingDone: jest.fn(),
  discoverForm: jest.fn(),
  scopeToForm: jest.fn(),
  setActivePhase: jest.fn(),
  setActiveStage: jest.fn(),
};

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js',
  () => ({
    createElementMediator: jest.fn().mockReturnValue(MOCK_MEDIATOR),
    extractActionMediator: jest.fn().mockReturnValue(MOCK_MEDIATOR),
    default: jest.fn().mockReturnValue(MOCK_MEDIATOR),
  }),
);

const CAMOUFOX_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js');
const INIT_MOD = await import('../../../../../Scrapers/Pipeline/Phases/Init/InitPhaseFactory.js');
const TERMINATE_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/Terminate/TerminateActions.js');

// ── Helpers ────────────────────────────────────────────────

/** Mock browser stack returned by MAKE_BROWSER_MOCK. */
interface IMockBrowserStack {
  readonly mockBrowser: { newContext: jest.Mock; close: jest.Mock };
  readonly mockContext: { newPage: jest.Mock; close: jest.Mock; clearCookies: jest.Mock };
  readonly mockPage: {
    setDefaultTimeout: jest.Mock;
    close: jest.Mock;
    url: () => string;
    goto: jest.Mock;
    locator: jest.Mock;
    on: jest.Mock;
    off: jest.Mock;
  };
}

/**
 * Create a chainable mock browser with context and page.
 * @returns Mock browser, context, and page objects.
 */
const MAKE_BROWSER_MOCK = (): IMockBrowserStack => {
  const mockPage = {
    setDefaultTimeout: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    /**
     * Mock URL getter.
     * @returns Test bank URL string.
     */
    url: (): string => 'https://test.bank',
    /**
     * Mock title getter.
     * @returns Test page title.
     */
    title: (): Promise<string> => Promise.resolve('Test Bank'),
    goto: jest.fn().mockResolvedValue(null),
    locator: jest.fn().mockReturnValue({ first: jest.fn().mockReturnValue({ click: jest.fn() }) }),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
  };
  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
    clearCookies: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { mockBrowser, mockContext, mockPage };
};

/** Mock exposing a jest `close`, used to record the cleanup drain order. */
interface ICloseableMock {
  readonly close: jest.Mock;
}

/**
 * Re-wire a mock's close to append its label to {@link CLEANUP_ORDER}.
 * @param closeable - Mock whose close should be recorded.
 * @param label - Name recorded when close runs.
 * @returns True once the recorder is installed.
 */
function recordCloseOrder(closeable: ICloseableMock, label: string): boolean {
  closeable.close.mockImplementation((): Promise<boolean> => {
    CLEANUP_ORDER.push(label);
    return Promise.resolve(true);
  });
  return true;
}

// ── Tests ─────────────────────────────────────────────────

describe('INIT_STEP', () => {
  it('has name "init-browser"', () => {
    expect(INIT_MOD.INIT_STEP.name).toBe('init-browser');
  });
});

describe('InitPhase/headless', () => {
  it('launches headless=true when shouldShowBrowser is false (default)', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT();
    await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(launchFn).toHaveBeenCalledWith(true);
  });

  it('launches headless=false when shouldShowBrowser is true', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT({
      options: makeMockOptions({ shouldShowBrowser: true }),
    });
    await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(launchFn).toHaveBeenCalledWith(false);
  });
});

describe('InitPhase/coldStartIfDumping', () => {
  it('clears context cookies when DUMP_SNAPSHOTS=1 (cold-start protocol)', async () => {
    const prior = process.env.DUMP_SNAPSHOTS;
    process.env.DUMP_SNAPSHOTS = '1';
    try {
      const { mockBrowser, mockContext } = MAKE_BROWSER_MOCK();
      const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
      launchFn.mockResolvedValue(mockBrowser);
      const ctx = MAKE_MOCK_CONTEXT();
      await INIT_MOD.INIT_STEP.execute(ctx, ctx);
      expect(mockContext.clearCookies).toHaveBeenCalledTimes(1);
    } finally {
      if (prior === undefined) delete process.env.DUMP_SNAPSHOTS;
      else process.env.DUMP_SNAPSHOTS = prior;
    }
  });

  it('does NOT clear context cookies when DUMP_SNAPSHOTS is unset', async () => {
    const prior = process.env.DUMP_SNAPSHOTS;
    delete process.env.DUMP_SNAPSHOTS;
    try {
      const { mockBrowser, mockContext } = MAKE_BROWSER_MOCK();
      const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
      launchFn.mockResolvedValue(mockBrowser);
      const ctx = MAKE_MOCK_CONTEXT();
      await INIT_MOD.INIT_STEP.execute(ctx, ctx);
      expect(mockContext.clearCookies).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.DUMP_SNAPSHOTS;
      else process.env.DUMP_SNAPSHOTS = prior;
    }
  });
});

describe('InitPhase/prepareBrowser', () => {
  it('calls prepareBrowser when provided in options', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const prepBrowser = jest.fn().mockResolvedValue(undefined);
    const ctx = MAKE_MOCK_CONTEXT({
      options: makeMockOptions({ prepareBrowser: prepBrowser }),
    });
    await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(prepBrowser).toHaveBeenCalledWith(mockBrowser);
  });

  it('does NOT call prepareBrowser when absent', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT();
    const result = await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
  });
});

describe('InitPhase/setupPage', () => {
  it('calls page.setDefaultTimeout when defaultTimeout is set', async () => {
    const { mockBrowser, mockPage } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT({
      options: makeMockOptions({ defaultTimeout: 30000 }),
    });
    await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(30000);
  });

  it('does NOT call setDefaultTimeout when defaultTimeout is absent', async () => {
    const { mockBrowser, mockPage } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT();
    await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(mockPage.setDefaultTimeout).not.toHaveBeenCalled();
  });

  it('calls preparePage when provided', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const prepPage = jest.fn().mockResolvedValue(undefined);
    const ctx = MAKE_MOCK_CONTEXT({
      options: makeMockOptions({ preparePage: prepPage }),
    });
    await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(prepPage).toHaveBeenCalled();
  });
});

describe('InitPhase/success', () => {
  it('returns succeed with browser, fetchStrategy, mediator populated', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT();
    const result = await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.browser.has).toBe(true);
      expect(result.value.fetchStrategy.has).toBe(true);
      expect(result.value.mediator.has).toBe(true);
    }
  });
});

describe('InitPhase/cleanups', () => {
  it('drains LIFO so the session is saved before anything closes', async () => {
    CLEANUP_ORDER.length = 0;
    const { mockBrowser, mockContext, mockPage } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    recordCloseOrder(mockPage, 'page');
    recordCloseOrder(mockContext, 'context');
    recordCloseOrder(mockBrowser, 'browser');
    const ctx = MAKE_MOCK_CONTEXT();
    const result = await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    assertOk(result);
    const browserState = result.value.browser;
    assertHas(browserState);
    const cleanups = browserState.value.cleanups;
    const count = await TERMINATE_MOD.runAllCleanups(cleanups, ctx.logger);
    // The drain is LIFO, so the save must sit LAST in the array to run
    // FIRST. Anywhere else it runs after browser.close() and persists
    // nothing — storageState throws on a closed context.
    expect({ count, order: CLEANUP_ORDER }).toEqual({
      count: 4,
      order: ['save', 'page', 'context', 'browser'],
    });
  });
});

describe('InitPhase/error', () => {
  it('returns fail when launchCamoufox throws', async () => {
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockRejectedValue(new Error('binary not found'));
    const ctx = MAKE_MOCK_CONTEXT();
    const result = await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('INIT PRE');
      expect(result.errorMessage).toContain('binary not found');
    }
  });

  it('returns fail when browser.newContext throws', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    mockBrowser.newContext = jest.fn().mockRejectedValue(new Error('context failed'));
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT();
    const result = await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('INIT PRE');
    }
  });
});

describe('InitPhase/browser-leak-prevention', () => {
  it('closes browser when newContext throws', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    mockBrowser.newContext = jest.fn().mockRejectedValue(new Error('context create failed'));
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT();
    await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('closes browser when preparePage throws', async () => {
    const { mockBrowser } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const throwingPrepPage = jest.fn().mockRejectedValue(new Error('preparePage crashed'));
    const ctx = MAKE_MOCK_CONTEXT({
      options: makeMockOptions({ preparePage: throwingPrepPage }),
    });
    await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    expect(mockBrowser.close).toHaveBeenCalled();
  });
});
