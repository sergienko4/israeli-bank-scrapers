/**
 * Shared mock factories for Pipeline infrastructure tests.
 * Follows project convention: typed factories, no inline `as never`.
 */

import type { Page } from 'playwright-core';

import type { CompanyTypes } from '../../../../Definitions.js';
import type { OtpConfig } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ScraperCredentials, ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { ScraperLogger } from '../../../../Scrapers/Pipeline/Types/Debug.js';
import { none } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Default company ID for test mocks. */
const TEST_COMPANY_ID = 'testBank';

/**
 * Create a minimal mock ScraperOptions.
 * @param overrides - Optional field overrides.
 * @returns A ScraperOptions object for testing.
 */
function makeMockOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  const defaults = {
    companyId: TEST_COMPANY_ID,
    startDate: new Date('2024-01-01'),
  };
  return { ...defaults, ...overrides } as ScraperOptions;
}

/**
 * Create minimal mock credentials.
 * @returns A ScraperCredentials object for testing.
 */
function makeMockCredentials(): ScraperCredentials {
  return { username: 'fixt-u-7c2f3e9a', password: 'fixt-p-9b41ad2e' };
}

/**
 * Create a minimal mock Playwright Page with isolated URL state.
 * @param initialUrl - The URL the page should report.
 * @returns A Page-compatible mock with its own URL closure.
 */
function makeMockPage(initialUrl = 'https://bank.example.com/login'): Page {
  let currentUrl = initialUrl;
  return {
    /**
     * Return this mock page's URL.
     * @returns The mock URL.
     */
    url: (): string => currentUrl,
    /**
     * Simulate navigation by updating the URL (async like Playwright).
     * @param newUrl - The new URL after navigation.
     * @returns Resolved null (matches Playwright Response | null).
     */
    goto: (newUrl: string): Promise<string> => {
      currentUrl = newUrl;
      return Promise.resolve(currentUrl);
    },
    /**
     * No-op event listener for network discovery.
     * @returns Self for chaining.
     */
    on: (): Page => ({}) as unknown as Page,
    /**
     * Mock waitForResponse — never resolves (fire-and-forget).
     * @returns Never-resolving promise.
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    /**
     * Mock frames — no iframes in test.
     * @returns Empty array.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

/**
 * Create a minimal mock IPipelineContext.
 * @param overrides - Optional field overrides.
 * @returns An IPipelineContext for testing.
 */
function makeMockContext(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  const defaults: IPipelineContext = {
    options: makeMockOptions(),
    credentials: makeMockCredentials(),
    companyId: TEST_COMPANY_ID as unknown as CompanyTypes,
    logger: {
      /**
       * No-op debug.
       * @returns True.
       */
      debug: (): boolean => true,
      /**
       * No-op trace.
       * @returns True.
       */
      trace: (): boolean => true,
      /**
       * No-op info.
       * @returns True.
       */
      info: (): boolean => true,
      /**
       * No-op warn.
       * @returns True.
       */
      warn: (): boolean => true,
      /**
       * No-op error.
       * @returns True.
       */
      error: (): boolean => true,
    } as unknown as ScraperLogger,
    diagnostics: {
      loginUrl: '',
      finalUrl: none(),
      loginStartMs: 0,
      fetchStartMs: none(),
      lastAction: 'test',
      pageTitle: none(),
      warnings: [],
    },
    config: {
      urls: { base: 'https://test.bank' },
    },
    fetchStrategy: none(),
    mediator: none(),
    apiMediator: none(),
    browser: none(),
    login: none(),
    dashboard: none(),
    scrape: none(),
    api: none(),
    loginAreaReady: false,
    preLoginDiscovery: none(),
    loginFieldDiscovery: none(),
    scrapeDiscovery: none(),
  };
  return { ...defaults, ...overrides };
}

/**
 * Create a minimal mock IPipelineDescriptor.
 * @param options - ScraperOptions to use.
 * @returns A descriptor with empty phases.
 */
function makeMockDescriptor(
  options: ScraperOptions = makeMockOptions(),
): Procedure<IPipelineDescriptor> {
  const descriptor: IPipelineDescriptor = {
    options,
    phases: [],
    interceptors: [],
  };
  return succeed(descriptor);
}

// ── PipelineBuilder shared stubs ──────────────────────────

/** Minimal ILoginConfig stub for builder tests. */
const MOCK_LOGIN_CONFIG: ILoginConfig = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent', value: 'Login' },
  possibleResults: {},
} as unknown as ILoginConfig;

/**
 * Stub login function for direct-POST mode.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
const MOCK_DIRECT_LOGIN = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
  const result = succeed(ctx);
  return Promise.resolve(result);
};

/**
 * Stub login function for native mode.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
const MOCK_NATIVE_LOGIN = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
  const result = succeed(ctx);
  return Promise.resolve(result);
};

/**
 * Stub scrape function.
 * @param ctx - Action context.
 * @returns Resolved succeed procedure.
 */
const MOCK_SCRAPE = (ctx: IActionContext): Promise<Procedure<IPipelineContext>> => {
  const full = ctx as unknown as IPipelineContext;
  const result = succeed(full);
  return Promise.resolve(result);
};

/** Minimal OTP config for builder tests. */
const MOCK_OTP_CONFIG: OtpConfig = { kind: 'api' };

export {
  makeMockContext,
  makeMockCredentials,
  makeMockDescriptor,
  makeMockOptions,
  makeMockPage,
  MOCK_DIRECT_LOGIN,
  MOCK_LOGIN_CONFIG,
  MOCK_NATIVE_LOGIN,
  MOCK_OTP_CONFIG,
  MOCK_SCRAPE,
};
