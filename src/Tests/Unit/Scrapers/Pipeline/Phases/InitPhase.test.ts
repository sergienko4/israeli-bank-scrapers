/**
 * Unit tests for InitPhase.ts.
 * Mocks CamoufoxLauncher, Browser.buildContextOptions, CreateElementMediator.
 */

import { jest } from '@jest/globals';

import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
// Static imports of non-mocked factories — safe with jest.unstable_mockModule.
import { makeMockOptions } from '../../../Pipeline/Infrastructure/MockFactories.js';
import { makeMockContext as MAKE_MOCK_CONTEXT } from '../MockPipelineFactories.js';

jest.unstable_mockModule('../../../../../Common/CamoufoxLauncher.js', () => ({
  launchCamoufox: jest.fn(),
}));

jest.unstable_mockModule('../../../../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
  ISRAEL_LOCALE: 'he-IL',
  ISRAEL_TIMEZONE: 'Asia/Jerusalem',
}));

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/CreateElementMediator.js',
  () => ({
    createElementMediator: jest.fn().mockReturnValue({
      resolveField: jest.fn(),
      resolveClickable: jest.fn(),
      discoverErrors: jest.fn(),
      waitForLoadingDone: jest.fn(),
      discoverForm: jest.fn(),
      scopeToForm: jest.fn(),
    }),
    default: jest.fn().mockReturnValue({
      resolveField: jest.fn(),
      resolveClickable: jest.fn(),
      discoverErrors: jest.fn(),
      waitForLoadingDone: jest.fn(),
      discoverForm: jest.fn(),
      scopeToForm: jest.fn(),
    }),
  }),
);

const CAMOUFOX_MOD = await import('../../../../../Common/CamoufoxLauncher.js');
const INIT_MOD = await import('../../../../../Scrapers/Pipeline/Phases/InitPhase.js');

// ── Helpers ────────────────────────────────────────────────

/** Mock browser stack returned by MAKE_BROWSER_MOCK. */
interface IMockBrowserStack {
  readonly mockBrowser: { newContext: jest.Mock; close: jest.Mock };
  readonly mockContext: { newPage: jest.Mock; close: jest.Mock };
  readonly mockPage: {
    setDefaultTimeout: jest.Mock;
    close: jest.Mock;
    url: () => string;
    goto: jest.Mock;
    locator: jest.Mock;
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
    goto: jest.fn().mockResolvedValue(null),
    locator: jest.fn().mockReturnValue({ first: jest.fn().mockReturnValue({ click: jest.fn() }) }),
  };
  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { mockBrowser, mockContext, mockPage };
};

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
  it('cleanup functions close page, context, browser', async () => {
    const { mockBrowser, mockContext, mockPage } = MAKE_BROWSER_MOCK();
    const launchFn = CAMOUFOX_MOD.launchCamoufox as jest.Mock;
    launchFn.mockResolvedValue(mockBrowser);
    const ctx = MAKE_MOCK_CONTEXT();
    const result = await INIT_MOD.INIT_STEP.execute(ctx, ctx);
    assertOk(result);
    const browserState = result.value.browser;
    assertHas(browserState);
    const cleanups = browserState.value.cleanups;
    expect(cleanups).toHaveLength(3);
    const didClosePage = await cleanups[0]();
    expect(didClosePage).toBe(true);
    expect(mockPage.close).toHaveBeenCalled();
    const didCloseContext = await cleanups[1]();
    expect(didCloseContext).toBe(true);
    expect(mockContext.close).toHaveBeenCalled();
    const didCloseBrowser = await cleanups[2]();
    expect(didCloseBrowser).toBe(true);
    expect(mockBrowser.close).toHaveBeenCalled();
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
      expect(result.errorMessage).toContain('InitPhase failed');
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
      expect(result.errorMessage).toContain('InitPhase failed');
    }
  });
});
