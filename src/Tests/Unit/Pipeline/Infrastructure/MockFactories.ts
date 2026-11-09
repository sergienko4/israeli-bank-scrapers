/**
 * Shared mock factories for Pipeline infrastructure tests.
 * Follows project convention: typed factories, no inline `as never`.
 */

import pino from 'pino';

import type { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperCredentials, ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { ScraperLogger } from '../../../../Scrapers/Pipeline/Logging/Debug.js';
import type { IRecoveryMethods } from '../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import type { IApiDirectCallConfig } from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IApiDirectScrapeShape } from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Default company ID for test mocks. Deliberately not a real bank, so no
 * bank-specific config ever matches it; this is the one place it enters the
 * enum.
 */
const TEST_COMPANY_ID = 'testBank' as unknown as CompanyTypes;

/**
 * Create a no-op {@link ScraperLogger} suitable for tests that do
 * not assert on logger output. Backed by a silent pino instance —
 * no `as unknown as` cast required, every Logger method works at
 * runtime (CodeRabbit 2026-05-16 findings #17 + #26).
 *
 * @returns Silent pino Logger conforming to ScraperLogger.
 */
export function createMockLogger(): ScraperLogger {
  return pino({ enabled: false });
}

/**
 * Inert `setSessionWarm` stub — echoes the flag, records nothing.
 * @param value - The warm flag, returned unchanged.
 * @returns The same boolean value.
 */
function echoSessionWarm(value: boolean): boolean {
  return value;
}

/**
 * Always-false `wasSessionWarm` stub — keeps the self-heal fast-path a no-op.
 * @returns false
 */
function notSessionWarm(): boolean {
  return false;
}

/**
 * Per-request recovery stub — the default, so the warm-session rule decides.
 * @returns false
 */
function notWholeScrape(): boolean {
  return false;
}

/**
 * Inert `recoverSession` stub — never consumed while `wasSessionWarm` is false.
 * @returns A resolved empty success {@link Procedure}.
 */
async function recoverSessionNoop(): Promise<Procedure<string>> {
  await Promise.resolve();
  return succeed('');
}

/**
 * Inert `setAuthPolicy` stub — accepts the policy, records nothing.
 * @returns true
 */
function acceptAuthPolicy(): boolean {
  return true;
}

/**
 * Build no-op warm-session self-heal stubs to spread into a mock mediator.
 *
 * Fast-path default: `wasSessionWarm` returns false, so the shared
 * `runScrapeWithRecovery` wrapper never enters the recovery branch — every
 * template-mock scrape stays byte-identical to its pre-self-heal behaviour.
 * `recoverSession`'s value is never consumed on that path.
 *
 * @returns The {@link IRecoveryMethods} stubs for a mock mediator.
 */
function makeRecoverySessionStubs(): IRecoveryMethods {
  return {
    setSessionWarm: echoSessionWarm,
    wasSessionWarm: notSessionWarm,
    recoversWholeScrape: notWholeScrape,
    recoverSession: recoverSessionNoop,
    setAuthPolicy: acceptAuthPolicy,
  };
}

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
  return { ...defaults, ...overrides };
}

/**
 * Create minimal mock credentials.
 * @returns A ScraperCredentials object for testing.
 */
function makeMockCredentials(): ScraperCredentials {
  return { username: 'fixt-u-7c2f3e9a', password: 'fixt-p-9b41ad2e' };
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
    companyId: TEST_COMPANY_ID,
    logger: createMockLogger(),
    config: {
      urls: { base: 'https://test.bank' },
      balanceKind: 'account',
      authStrategyKind: 'token',
    },
    windowEnd: none(),
    apiMediator: none(),
    scrape: none(),
    durableAuth: none(),
    balanceResolution: none(),
  };
  return {
    ...defaults,
    ...overrides,
    config: { ...defaults.config, ...overrides.config },
  };
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
  };
  return succeed(descriptor);
}

// ── PipelineBuilder shared stubs ──────────────────────────

/** Minimal IApiDirectCallConfig for builder tests. */
const MOCK_API_DIRECT = { steps: [] } as unknown as IApiDirectCallConfig;

/** Minimal IApiDirectScrapeShape for builder tests (paired with MOCK_API_DIRECT). */
const MOCK_API_DIRECT_SHAPE = {} as unknown as IApiDirectScrapeShape<unknown, unknown>;

export {
  makeMockContext,
  makeMockCredentials,
  makeMockDescriptor,
  makeMockOptions,
  makeRecoverySessionStubs,
  MOCK_API_DIRECT,
  MOCK_API_DIRECT_SHAPE,
};
