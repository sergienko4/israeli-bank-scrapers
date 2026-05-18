/**
 * Centralized mock module factories for jest.unstable_mockModule.
 *
 * Each factory returns a fresh mock object suitable for passing
 * to `jest.unstable_mockModule(path, factory)`. This eliminates
 * 20+ lines of duplicated inline mock implementations per test.
 *
 * Usage:
 * ```ts
 * import { createDebugMock, createNavigationMock } from '../MockModuleFactories.js';
 * jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);
 * jest.unstable_mockModule('../../Common/Navigation.js',
 *   () => createNavigationMock('https://success.url'));
 * ```
 */
import { jest } from '@jest/globals';

/** Logger mock with all pino levels. */
type MockLogger = Record<string, jest.Mock>;

/**
 * Create a mock logger with trace/debug/info/warn/error.
 * @returns fresh mock logger
 */
function mockLogger(): MockLogger {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/**
 * Debug module mock with passthrough bank context.
 * @returns Debug mock module
 */
export function createDebugMock(): {
  getDebug: () => MockLogger;
  runWithBankContext: <T>(_b: string, fn: () => T) => T;
} {
  return {
    getDebug: mockLogger,
    /**
     * Pass-through bank context for tests.
     * @param _b - bank name (unused)
     * @param fn - callback to execute
     * @returns fn() result
     */
    runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
  };
}

/**
 * Navigation module mock with configurable success URL.
 * @param successUrl - URL returned by getCurrentUrl
 * @returns Navigation mock module
 */
export function createNavigationMock(successUrl: string): {
  getCurrentUrl: jest.Mock;
  waitForNavigation: jest.Mock;
  waitForNavigationAndDomLoad: jest.Mock;
  waitForRedirect: jest.Mock;
  waitForUrl: jest.Mock;
} {
  return {
    getCurrentUrl: jest.fn().mockResolvedValue(successUrl),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
    waitForRedirect: jest.fn().mockResolvedValue(undefined),
    waitForUrl: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * ElementsInteractions module mock with all stubs.
 * @returns ElementsInteractions mock module
 */
export function createElementsMock(): {
  clickButton: jest.Mock;
  fillInput: jest.Mock;
  waitUntilElementFound: jest.Mock;
  waitUntilIframeFound: jest.Mock;
  elementPresentOnPage: jest.Mock;
  capturePageText: jest.Mock;
  pageEval: jest.Mock;
  pageEvalAll: jest.Mock;
} {
  return {
    clickButton: jest.fn().mockResolvedValue(undefined),
    fillInput: jest.fn().mockResolvedValue(undefined),
    waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
    waitUntilIframeFound: jest.fn().mockResolvedValue(undefined),
    elementPresentOnPage: jest.fn().mockResolvedValue(false),
    capturePageText: jest.fn().mockResolvedValue(''),
    pageEval: jest.fn().mockResolvedValue(null),
    pageEvalAll: jest.fn().mockResolvedValue([]),
  };
}

/**
 * Fetch module mock with get and post stubs.
 * @returns Fetch mock module
 */
export function createFetchMock(): {
  fetchGetWithinPage: jest.Mock;
  fetchPostWithinPage: jest.Mock;
} {
  return {
    fetchGetWithinPage: jest.fn(),
    fetchPostWithinPage: jest.fn(),
  };
}

/**
 * Browser module mock.
 * @returns Browser mock module
 */
export function createBrowserMock(): {
  buildContextOptions: jest.Mock;
} {
  return { buildContextOptions: jest.fn().mockReturnValue({}) };
}

/**
 * CamoufoxLauncher module mock — provides every export the real module
 * ships so ESM imports in production code (e.g. `buildCloseAndStripCleanup`
 * imported by `BaseScraperWithBrowser.ts`) resolve cleanly even when the
 * test file only cares about `launchCamoufox`.
 *
 * Important shape: `launchCamoufoxForBank` delegates to `launchCamoufox`
 * so existing tests that drive `launchCamoufox.mockResolvedValue(...)`
 * keep working after the production path switched to the bank-scoped
 * entrypoint. The delegation also keeps the call-count assertions on
 * `launchCamoufox` valid.
 * @returns CamoufoxLauncher mock module with stubs for every export.
 */
export function createCamoufoxMock(): {
  ISRAEL_LOCALE: string;
  buildCloseAndStripCleanup: jest.Mock;
  getProfileDir: jest.Mock;
  isPersistentProfilesEnabled: jest.Mock;
  launchCamoufox: jest.Mock;
  launchCamoufoxForBank: jest.Mock;
  stripProfileCache: jest.Mock;
} {
  const launchFn = jest.fn();
  // `launchCamoufoxForBank` delegates to `launchCamoufox` here so
  // existing tests that drive `launchFn.mockResolvedValue(...)` keep
  // working. The second `bank` param is intentionally ignored at the
  // mock layer — only the `headless` boolean affects which mock value
  // gets returned. Using `unknown` as the impl return type avoids the
  // unsafe-any flag because `jest.fn()` would otherwise infer `any`.
  const forBankFn = jest.fn((headless: boolean): unknown => launchFn(headless) as unknown);
  // The composite-cleanup mock MUST actually call `result.close()` so
  // existing tests that assert `mockBrowser.close` was invoked after
  // running the cleanup keep working. The strip-cache branch is a
  // no-op here (mock doesn't simulate Firefox profile filesystem).
  const closeAndStripFn = jest.fn(
    (result: { close: () => Promise<unknown> }) => async (): Promise<true> => {
      await result.close();
      return true;
    },
  );
  return {
    ISRAEL_LOCALE: 'he-IL',
    buildCloseAndStripCleanup: closeAndStripFn,
    getProfileDir: jest.fn().mockReturnValue('mock-profile-path'),
    isPersistentProfilesEnabled: jest.fn().mockReturnValue(false),
    launchCamoufox: launchFn,
    launchCamoufoxForBank: forBankFn,
    stripProfileCache: jest.fn().mockReturnValue(true),
  };
}

/**
 * Transactions module mock with passthrough filter.
 * @returns Transactions mock module
 */
export function createTransactionsMock(): {
  getRawTransaction: jest.Mock;
  filterOldTransactions: jest.Mock;
  fixInstallments: jest.Mock;
  sortTransactionsByDate: jest.Mock;
} {
  return {
    getRawTransaction: jest.fn(
      (data: Record<string, string | number>): Record<string, string | number> => data,
    ),
    filterOldTransactions: jest.fn(<T>(txns: T[]): T[] => txns),
    fixInstallments: jest.fn(<T>(txns: T[]): T[] => txns),
    sortTransactionsByDate: jest.fn(<T>(txns: T[]): T[] => txns),
  };
}

/**
 * Internal stubs for sleep, delay, serial, waitUntil, raceTimeout.
 * @returns timing mock stubs
 */
function serialRunnerStubs(): {
  sleep: jest.Mock;
  humanDelay: jest.Mock;
  runSerial: jest.Mock;
  waitUntil: jest.Mock;
  raceTimeout: jest.Mock;
} {
  return {
    sleep: jest.fn().mockResolvedValue(undefined),
    humanDelay: jest.fn().mockResolvedValue(undefined),
    runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
      const seed = Promise.resolve([] as T[]);
      return actions.reduce(
        (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
        seed,
      );
    }),
    waitUntil: jest.fn(async <T>(func: () => Promise<T>): Promise<T> => func()),
    raceTimeout: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Waiting module mock with real runSerial implementation.
 * @returns Waiting mock module
 */
export function createWaitingMock(): {
  sleep: jest.Mock;
  humanDelay: jest.Mock;
  runSerial: jest.Mock;
  waitUntil: jest.Mock;
  raceTimeout: jest.Mock;
  TimeoutError: typeof Error;
  SECOND: number;
} {
  const stubs = serialRunnerStubs();
  return { ...stubs, TimeoutError: Error, SECOND: 1000 };
}

/**
 * OtpHandler module mock.
 * @returns OtpHandler mock module
 */
export function createOtpMock(): {
  handleOtpStep: jest.Mock;
  handleOtpCode: jest.Mock;
  handleOtpConfirm: jest.Mock;
} {
  return {
    handleOtpStep: jest.fn().mockResolvedValue(null),
    handleOtpCode: jest.fn().mockResolvedValue({ success: true }),
    handleOtpConfirm: jest.fn().mockResolvedValue(''),
  };
}

/**
 * Storage module mock (used by VisaCal).
 * @returns Storage mock module
 */
export function createStorageMock(): {
  getFromSessionStorage: jest.Mock;
} {
  return { getFromSessionStorage: jest.fn() };
}

/**
 * XPath literal escaper matching production SelectorResolver.toXpathLiteral.
 * This is a deliberate copy — cannot import the production module because
 * test files use this inside jest.unstable_mockModule('SelectorResolver', ...)
 * which replaces the real module. Importing would defeat the mock.
 * @param value - The raw string value.
 * @returns XPath-safe quoted string.
 */
export function mockToXpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  const parts = value.split('"').map((part: string) => `"${part}"`);
  return `concat(${parts.join(", '\"', ")})`;
}
