/**
 * Shared test helpers for WAF challenge interceptor unit suites.
 *
 * <p>Extracted per CLAUDE.md "Tests must NOT duplicate production logic —
 * import shared helpers". Backs every WafChallenge test file so the same
 * env-reset, logger-mock, and Page-stub factories live in one place.
 */

import pino from 'pino';
import type { Page } from 'playwright-core';

import { WAF_INTERCEPTOR_DISABLED_ENV } from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeConfig.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';

/**
 * Reset the WAF_INTERCEPTOR_DISABLED env var to an absent state.
 *
 * <p>Uses assignment instead of delete to avoid no-dynamic-delete ESLint rule.
 * @returns true sentinel.
 */
function clearDisableEnv(): true {
  process.env[WAF_INTERCEPTOR_DISABLED_ENV] = '';
  return true;
}

/**
 * Build a silent pino logger that satisfies the ScraperLogger contract.
 * @returns Disabled pino logger.
 */
function makeLogger(): ScraperLogger {
  return pino({ enabled: false });
}

/** Page-shaped stub with frames() and on() — sufficient for poller/detector tests. */
interface IPageStub {
  /**
   * Mock frames() — returns the configured list.
   * @returns The configured frame list.
   */
  readonly frames: () => readonly object[];
  /**
   * Mock on() — registers a no-op listener; returns the stub for chaining.
   * @returns Self for chaining.
   */
  readonly on: () => IPageStub;
}

/**
 * Build a Page stub with a configurable frames() implementation.
 * @param frames - Frames to return from page.frames(); empty by default.
 * @returns Page-shaped mock cast through the IPageStub contract.
 */
function makePageStub(frames: readonly object[] = []): Page {
  const stub: IPageStub = {
    /**
     * Mock frames() — returns the configured list.
     * @returns The configured frame list.
     */
    frames: (): readonly object[] => frames,
    /**
     * Mock on() — registers a no-op listener; returns the stub for chaining.
     * @returns Self for chaining.
     */
    on: (): IPageStub => stub,
  };
  return stub as unknown as Page;
}

export { clearDisableEnv, makeLogger, makePageStub };
export type { IPageStub };
