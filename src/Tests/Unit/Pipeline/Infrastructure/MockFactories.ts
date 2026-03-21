/**
 * Shared mock factories for Pipeline infrastructure tests.
 * Follows project convention: typed factories, no inline `as never`.
 */

import type { Page } from 'playwright-core';

import type { ScraperCredentials, ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/PipelineDescriptor.js';
import { none } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
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
  return { username: 'testuser', password: 'testpass' } as ScraperCredentials;
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
    companyId: TEST_COMPANY_ID as never,
    logger: {} as never,
    diagnostics: {
      loginUrl: '',
      finalUrl: none(),
      loginStartMs: 0,
      fetchStartMs: none(),
      lastAction: 'test',
      pageTitle: none(),
      warnings: [],
    },
    config: {} as never,
    fetchStrategy: none(),
    mediator: none(),
    browser: none(),
    login: none(),
    dashboard: none(),
    scrape: none(),
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
  const descriptor: IPipelineDescriptor = { options, phases: [] };
  return succeed(descriptor);
}

export { makeMockContext, makeMockCredentials, makeMockDescriptor, makeMockOptions, makeMockPage };
