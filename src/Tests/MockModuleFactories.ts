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
 * CamoufoxLauncher module mock.
 * @returns CamoufoxLauncher mock module
 */
export function createCamoufoxMock(): {
  launchCamoufox: jest.Mock;
} {
  return { launchCamoufox: jest.fn() };
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
    filterOldTransactions: jest.fn(<T>(_d: Date, txns: T[]): T[] => txns),
    fixInstallments: jest.fn(<T>(txns: T[]): T[] => txns),
    sortTransactionsByDate: jest.fn(<T>(txns: T[]): T[] => txns),
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
    TimeoutError: Error,
    SECOND: 1000,
  };
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
