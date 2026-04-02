/**
 * Shared mock factories for Pipeline Phases/Strategy/Mediator/Registry tests.
 * Extends core MockFactories with browser, login, mediator, fetch, and scrape mocks.
 * All void returns replaced with boolean — project forbids void return type.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

/** Whether a mock operation completed successfully. */
type MockResult = boolean;
/** Mock URL string. */
type MockUrl = string;

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type {
  ICookieSnapshot,
  IElementMediator,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFormErrorScanResult } from '../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';
import type { IFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  ILoginState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Pre-built succeed(undefined) — reusable across test mocks. */
const VOID_SUCCESS: Procedure<void> = succeed(undefined);

/** Pre-built resolved promise — avoids nested call lint violations in mocks. */
export const SUCCEED_VOID: Promise<Procedure<void>> = Promise.resolve(VOID_SUCCESS);
import type {
  IRawAccount,
  IScrapeConfig,
} from '../../../../Scrapers/Pipeline/Types/ScrapeConfig.js';
import {
  type ITransaction,
  TransactionStatuses,
  TransactionTypes,
} from '../../../../Transactions.js';
import { makeMockContext, makeMockPage } from '../../Pipeline/Infrastructure/MockFactories.js';

export { makeMockContext, makeMockPage };

// ── Browser mocks ─────────────────────────────────────────

/** Minimal locator mock used by makeMockFullPage. */
const MOCK_LOCATOR = {
  /**
   * Return the first-element locator mock.
   * @returns First locator with click/fill/isVisible/waitFor/evaluate.
   */
  first: (): object => ({
    /**
     * Click mock.
     * @returns True.
     */
    click: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Fill mock.
     * @returns True.
     */
    fill: (): Promise<boolean> => Promise.resolve(true),
    /**
     * IsVisible mock — returns false.
     * @returns False.
     */
    isVisible: (): Promise<boolean> => Promise.resolve(false),
    /**
     * WaitFor mock.
     * @returns True.
     */
    waitFor: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Evaluate mock — returns false (no hidden-control attribute).
     * @returns False.
     */
    evaluate: (): Promise<boolean> => Promise.resolve(false),
  }),
  /**
   * Fill mock on locator.
   * @returns True.
   */
  fill: (): Promise<boolean> => Promise.resolve(true),
};

/** Minimal getByText mock used by makeMockFullPage. */
const MOCK_GET_BY_TEXT = {
  /**
   * Return the first-element locator mock.
   * @returns First locator with waitFor/isVisible.
   */
  first: (): object => ({
    /**
     * WaitFor mock.
     * @returns True.
     */
    waitFor: (): Promise<boolean> => Promise.resolve(true),
    /**
     * IsVisible mock — returns false.
     * @returns False.
     */
    isVisible: (): Promise<boolean> => Promise.resolve(false),
    /**
     * Click mock.
     * @returns True.
     */
    click: (): Promise<boolean> => Promise.resolve(true),
  }),
};

/**
 * Create a mock Page with extended lifecycle methods for pipeline tests.
 * @param initialUrl - Starting URL.
 * @returns Extended mock page with close, setDefaultTimeout, waitForLoadState.
 */
export function makeMockFullPage(initialUrl = 'https://bank.example.com'): Page {
  const base = makeMockPage(initialUrl);
  return {
    ...base,
    /**
     * Close the page mock.
     * @returns Resolved true.
     */
    close: (): Promise<boolean> => Promise.resolve(true),
    /**
     * No-op timeout setter mock.
     * @returns True.
     */
    setDefaultTimeout: (): MockResult => true,
    /**
     * Resolves immediately for any load state.
     * @returns Resolved true.
     */
    waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
    /**
     * Return a minimal locator mock.
     * @returns Locator with click, fill, isVisible, waitFor.
     */
    locator: (): typeof MOCK_LOCATOR => MOCK_LOCATOR,
    /**
     * Return a minimal getByText mock.
     * @returns GetByText with first().
     */
    getByText: (): typeof MOCK_GET_BY_TEXT => MOCK_GET_BY_TEXT,
    /**
     * No-op fill mock.
     * @returns Resolved true.
     */
    fill: (): Promise<boolean> => Promise.resolve(true),
    /**
     * No-op event listener mock for network discovery.
     * @returns Self for chaining.
     */
    on: (): Page => ({}) as unknown as Page,
    /**
     * Mock waitForResponse — resolves immediately with no match.
     * @returns Never-resolving promise (interceptor fire-and-forget).
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    /**
     * Mock frames — returns empty array (no iframes in test).
     * @returns Empty array.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

/**
 * Create a mock Page where getByText().isVisible() is controlled by a callback.
 * Used for testing waitForLoadingDone retry logic.
 * @param isVisibleFn - Returns true when loading indicator should appear visible.
 * @returns Mock Page with controllable loading visibility.
 */
export function makeMockLoadingPage(isVisibleFn: () => boolean): Page {
  const base = makeMockFullPage();
  return {
    ...base,
    /**
     * Return locator whose isVisible delegates to isVisibleFn.
     * @returns GetByText mock with controllable visibility.
     */
    getByText: (): typeof MOCK_GET_BY_TEXT => ({
      /**
       * Return first locator with controllable isVisible.
       * @returns Locator mock.
       */
      first: (): object => ({
        /**
         * Delegate visibility to the provided callback.
         * @returns Whether loading indicator should appear visible.
         */
        isVisible: (): Promise<boolean> => {
          const isVisible = isVisibleFn();
          return Promise.resolve(isVisible);
        },
      }),
    }),
    /**
     * No-op timeout mock for retry delays.
     * @returns Resolved true.
     */
    waitForTimeout: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;
}

/**
 * Create a mock BrowserContext.
 * @param page - The page returned by newPage().
 * @returns Mock BrowserContext.
 */
export function makeMockBrowserContext(page: Page = makeMockFullPage()): BrowserContext {
  return {
    /**
     * Return the provided mock page.
     * @returns Resolved page.
     */
    newPage: (): Promise<Page> => Promise.resolve(page),
    /**
     * Close the context mock.
     * @returns Resolved true.
     */
    close: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as BrowserContext;
}

/**
 * Create a mock Browser.
 * @param context - The context returned by newContext().
 * @returns Mock Browser.
 */
export function makeMockBrowser(context: BrowserContext = makeMockBrowserContext()): Browser {
  return {
    /**
     * Return the provided mock context.
     * @returns Resolved context.
     */
    newContext: (): Promise<BrowserContext> => Promise.resolve(context),
    /**
     * Close the browser mock.
     * @returns Resolved true.
     */
    close: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Browser;
}

/**
 * Default cleanups: two functions that resolve succeed(undefined).
 * @returns Two cleanup functions that resolve with Procedure<void>.
 */
const DEFAULT_CLEANUPS: IBrowserState['cleanups'] = [
  (): Promise<Procedure<void>> => SUCCEED_VOID,
  (): Promise<Procedure<void>> => SUCCEED_VOID,
];

/**
 * Create a mock IBrowserState.
 * @param page - Page in this browser state.
 * @param cleanups - Cleanup functions (default: two succeeding fns).
 * @returns Mock IBrowserState.
 */
export function makeMockBrowserState(
  page: Page = makeMockFullPage(),
  cleanups: IBrowserState['cleanups'] = DEFAULT_CLEANUPS,
): IBrowserState {
  const context = makeMockBrowserContext(page);
  return { page, context, cleanups };
}

// ── Login state mocks ─────────────────────────────────────

/**
 * Create a mock ILoginState.
 * @param frame - The active frame (defaults to a new mock page).
 * @returns Mock ILoginState.
 */
export function makeMockLoginState(frame: Page = makeMockFullPage()): ILoginState {
  return { activeFrame: frame, persistentOtpToken: none() };
}

// ── Fetch strategy mocks ──────────────────────────────────

/**
 * Create a mock IFetchStrategy that returns succeed(data) for all calls.
 * @param data - Response data to succeed with (default: empty object).
 * @returns Mock IFetchStrategy.
 */
export function makeMockFetchStrategy(data: object = {}): IFetchStrategy {
  return {
    /**
     * Return succeed with mock data.
     * @returns Succeed procedure with data.
     */
    fetchPost: <T>() => {
      const result = succeed(data as T);
      return Promise.resolve(result);
    },
    /**
     * Return succeed with mock data.
     * @returns Succeed procedure with data.
     */
    fetchGet: <T>() => {
      const result = succeed(data as T);
      return Promise.resolve(result);
    },
  } as unknown as IFetchStrategy;
}

// ── Mediator mocks ────────────────────────────────────────

/** No-errors result for mock mediator.discoverErrors. */
const MEDIATOR_NO_ERRORS: IFormErrorScanResult = { hasErrors: false, errors: [], summary: '' };

/** Failure result for mock resolveField/resolveClickable (field not found). */
const MEDIATOR_FAIL_RESULT = fail(ScraperErrorTypes.Generic, 'mock: not found');

/**
 * Create a mock IElementMediator.
 * resolveField and resolveClickable return failure by default.
 * Override methods via overrides parameter for success tests.
 * @param overrides - Optional method overrides.
 * @returns Mock IElementMediator.
 */
export function makeMockMediator(overrides: Partial<IElementMediator> = {}): IElementMediator {
  const base: IElementMediator = {
    /**
     * Failure — field not found. Override for success tests.
     * @returns Failure procedure.
     */
    resolveField: () => Promise.resolve(MEDIATOR_FAIL_RESULT),
    /**
     * Failure — clickable not found. Override for success tests.
     * @returns Failure procedure.
     */
    resolveClickable: () => Promise.resolve(MEDIATOR_FAIL_RESULT),
    /**
     * Return no-errors result.
     * @returns No-errors scan result.
     */
    discoverErrors: (): Promise<IFormErrorScanResult> => Promise.resolve(MEDIATOR_NO_ERRORS),
    /**
     * Loading done immediately — no spinners in tests.
     * @returns Succeed(true) — loading complete.
     */
    waitForLoadingDone: () => {
      const done = succeed(true as const);
      return Promise.resolve(done);
    },
    /**
     * Return none option.
     * @returns Resolved none.
     */
    discoverForm: () => {
      const result = none();
      return Promise.resolve(result);
    },
    /**
     * Best-effort click — returns succeed(NOT_FOUND_RESULT) by default. Override for success tests.
     * @returns Succeed with NOT_FOUND_RESULT.
     */
    resolveAndClick: () => {
      const notFound = succeed(NOT_FOUND_RESULT);
      return Promise.resolve(notFound);
    },
    /**
     * Not found by default. Override for success tests.
     * @returns NOT_FOUND_RESULT race result.
     */
    resolveVisible: (): Promise<typeof NOT_FOUND_RESULT> => Promise.resolve(NOT_FOUND_RESULT),
    /**
     * Return candidates unchanged.
     * @param candidates - Input candidates.
     * @returns Same array.
     */
    scopeToForm: candidates => candidates,
    /**
     * Navigation mock — always succeeds.
     * @returns Succeed(undefined).
     */
    navigateTo: (): Promise<Procedure<void>> => SUCCEED_VOID,
    /**
     * URL mock — returns about:blank.
     * @returns Mock URL string.
     */
    getCurrentUrl: (): MockUrl => 'about:blank',
    /**
     * Network idle mock — always succeeds.
     * @returns Succeed(undefined).
     */
    waitForNetworkIdle: (): Promise<Procedure<void>> => SUCCEED_VOID,
    /**
     * Count by text mock — returns 0 (no elements).
     * @returns Zero.
     */
    countByText: (): Promise<number> => Promise.resolve(0),
    /**
     * No DOM in mock — empty hrefs.
     * @returns Empty array.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve([]),
    /**
     * No cookies in mock.
     * @returns Empty array.
     */
    getCookies: (): Promise<readonly ICookieSnapshot[]> => Promise.resolve([]),
    /**
     * No-op cookie injection in mock.
     * @returns Resolved.
     */
    addCookies: (): Promise<void> => Promise.resolve(),
    network: {
      /**
       * No endpoints in mock.
       * @returns Empty array.
       */
      findEndpoints: (): readonly [] => [],
      /**
       * No services URL in mock.
       * @returns False.
       */
      getServicesUrl: (): false => false,
      /**
       * No endpoints in mock.
       * @returns Empty array.
       */
      getAllEndpoints: (): readonly [] => [],
      /**
       * No patterns discovered in mock.
       * @returns False.
       */
      discoverByPatterns: (): false => false,
      /**
       * No SPA URL in mock.
       * @returns False.
       */
      discoverSpaUrl: (): false => false,
      /**
       * No accounts in mock.
       * @returns False.
       */
      discoverAccountsEndpoint: (): false => false,
      /**
       * No transactions in mock.
       * @returns False.
       */
      discoverTransactionsEndpoint: (): false => false,
      /**
       * No balance in mock.
       * @returns False.
       */
      discoverBalanceEndpoint: (): false => false,
      /**
       * No auth token in mock.
       * @returns False.
       */
      discoverAuthToken: (): Promise<false> => Promise.resolve(false),
      /**
       * No origin in mock.
       * @returns False.
       */
      discoverOrigin: (): false => false,
      /**
       * No site ID in mock.
       * @returns False.
       */
      discoverSiteId: (): false => false,
      /**
       * Empty headers in mock.
       * @returns Default empty opts.
       */
      buildDiscoveredHeaders: (): Promise<{ extraHeaders: Record<string, string> }> =>
        Promise.resolve({ extraHeaders: {} }),
      /**
       * No transaction URL in mock.
       * @returns False.
       */
      buildTransactionUrl: (): false => false,
      /**
       * No balance URL in mock.
       * @returns False.
       */
      buildBalanceUrl: (): false => false,
      /**
       * No traffic in mock.
       * @returns False.
       */
      waitForTraffic: (): Promise<false> => Promise.resolve(false),
      /**
       * No auth cache in mock.
       * @returns False.
       */
      cacheAuthToken: (): Promise<false> => Promise.resolve(false),
      /**
       * No API origin in mock.
       * @returns False.
       */
      discoverApiOrigin: (): false => false,
      /**
       * No content match in mock.
       * @returns False.
       */
      discoverEndpointByContent: (): false => false,
    },
  };
  return { ...base, ...overrides };
}

// ── Scrape config mocks ───────────────────────────────────

/** Raw account used in mock scrape config. */
export const MOCK_RAW_ACCOUNT: IRawAccount = { accountId: 'ACC001', balance: 1000 };

/** Mock transaction returned by the scrape config mapper. */
const MOCK_TXN: ITransaction = {
  type: TransactionTypes.Normal,
  identifier: 1,
  date: '2025-01-01T00:00:00.000Z',
  processedDate: '2025-01-01T00:00:00.000Z',
  originalAmount: -100,
  originalCurrency: 'ILS',
  chargedAmount: -100,
  description: 'Test transaction',
  status: TransactionStatuses.Completed,
};

/**
 * Create a minimal GET-based IScrapeConfig for testing.
 * @param accounts - Raw accounts returned by accounts mapper.
 * @returns Mock IScrapeConfig.
 */
export function makeMockScrapeConfig(
  accounts: readonly IRawAccount[] = [MOCK_RAW_ACCOUNT],
): IScrapeConfig<object, object> {
  return {
    accounts: {
      method: 'GET',
      path: '/api/accounts',
      postData: {},
      /**
       * Map accounts API response to raw accounts.
       * @returns Provided accounts array.
       */
      mapper: () => accounts,
    },
    transactions: {
      method: 'GET',
      /**
       * Build request path for one account.
       * @param accountId - Account identifier.
       * @returns Request with path and empty postData.
       */
      buildRequest: (accountId: string) => ({ path: `/api/txns/${accountId}`, postData: {} }),
      /**
       * Map transaction API response.
       * @returns Single mock transaction array.
       */
      mapper: () => [MOCK_TXN],
    },
    pagination: { kind: 'none' },
    dateFormat: 'YYYYMMDD',
    defaultCurrency: 'ILS',
    /**
     * Return empty extra headers.
     * @returns Empty headers object.
     */
    extraHeaders: () => ({}),
  };
}

// ── Context helpers ───────────────────────────────────────

/**
 * Create a context with browser, fetchStrategy, and mediator all populated.
 * @param page - Page to use in browser state.
 * @returns Context with browser/fetchStrategy/mediator as some().
 */
export function makeContextWithBrowser(page: Page = makeMockFullPage()): IPipelineContext {
  const browserState = makeMockBrowserState(page);
  const fetchStrategy = makeMockFetchStrategy();
  const mediator = makeMockMediator();
  const browserSome = some(browserState);
  const fetchSome = some(fetchStrategy);
  const mediatorSome = some(mediator);
  return makeMockContext({
    browser: browserSome,
    fetchStrategy: fetchSome,
    mediator: mediatorSome,
  });
}

/**
 * Create a context with browser + login state both populated.
 * @param frame - Active frame for login state.
 * @returns Context with browser + login as some().
 */
export function makeContextWithLogin(frame: Page = makeMockFullPage()): IPipelineContext {
  const base = makeContextWithBrowser(frame);
  const loginState = makeMockLoginState(frame);
  const loginSome = some(loginState);
  return { ...base, login: loginSome, loginAreaReady: true };
}

/**
 * Create a context with mediator populated.
 * @param overrides - Optional mediator method overrides.
 * @returns Context with mediator as some().
 */
export function makeContextWithMediator(
  overrides: Partial<IElementMediator> = {},
): IPipelineContext {
  const mediator = makeMockMediator(overrides);
  const mediatorSome = some(mediator);
  return makeMockContext({ mediator: mediatorSome });
}
