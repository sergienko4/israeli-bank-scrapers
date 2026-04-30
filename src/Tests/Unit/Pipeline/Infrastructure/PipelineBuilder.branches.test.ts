/**
 * Unit tests for PipelineBuilder.ts — withScrapeConfig and resolveLoginStep branches.
 * Supplements PipelineBuilder.test.ts (which covers core builder API and phase assembly).
 */

import { PipelineBuilder } from '../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilder.js';
import { assertOk } from '../../../Helpers/AssertProcedure.js';
import {
  makeMockOptions,
  MOCK_DIRECT_LOGIN,
  MOCK_LOGIN_CONFIG,
  MOCK_NATIVE_LOGIN,
} from './MockFactories.js';

/** Shared test options. */
const MOCK_OPTIONS = makeMockOptions();

/** OTP config variant for branches tests (string-based). */

describe('PipelineBuilder/withScrapeConfig', () => {
  it('builds with withScrapeConfig instead of withScraper', () => {
    const mockConfig = {
      accounts: {
        method: 'GET' as const,
        path: '/api/accounts',
        postData: {},
        /**
         * Map accounts response.
         * @returns Empty array.
         */
        mapper: (): never[] => [],
      },
      transactions: {
        method: 'GET' as const,
        /**
         * Build request path.
         * @param id - Account id.
         * @returns Request object.
         */
        buildRequest: (id: string): { path: string; postData: Record<string, string> } => ({
          path: `/api/txns/${id}`,
          postData: {},
        }),
        /**
         * Map transaction response.
         * @returns Empty array.
         */
        mapper: (): never[] => [],
      },
      pagination: { kind: 'none' as const },
      dateFormat: 'YYYYMMDD',
      defaultCurrency: 'ILS',
      /**
       * Return empty headers.
       * @returns Empty object.
       */
      extraHeaders: (): Record<string, string> => ({}),
    };
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withScrapeConfig(mockConfig)
      .build();
    assertOk(descriptor);
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('scrape');
  });
});

describe('PipelineBuilder/resolveLoginStep-branches', () => {
  it('uses DECLARATIVE_LOGIN_STEP when OTP config with ILoginConfig', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withLoginAndOtpTrigger()
      .withLoginAndOptCodeFill()
      .build();
    assertOk(descriptor);
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
    expect(names).toContain('otp-trigger');
    expect(names).toContain('otp-fill');
  });

  it('uses LOGIN_STEPS map for directPost login mode', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .build();
    assertOk(descriptor);
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
  });

  it('executes the adapted fn when withDeclarativeLogin receives a function', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_DIRECT_LOGIN)
      .build();
    assertOk(descriptor);
    const loginPhase = descriptor.value.phases[0];
    expect(loginPhase.name).toBe('login');
  });

  it('uses fn-adapted step when withDeclarativeLogin(fn) + OTP', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_DIRECT_LOGIN)
      .withLoginAndOtpTrigger()
      .withLoginAndOptCodeFill()
      .build();
    assertOk(descriptor);
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
    expect(names).toContain('otp-trigger');
    expect(names).toContain('otp-fill');
  });

  it('uses LOGIN_STEPS map for native login mode', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    assertOk(descriptor);
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
  });
});
