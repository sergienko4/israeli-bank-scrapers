/**
 * Unit tests for PipelineBuilder.ts — withScrapeConfig and resolveLoginStep branches.
 * Supplements PipelineBuilder.test.ts (which covers core builder API and phase assembly).
 */

import type { OtpConfig } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { PipelineBuilder } from '../../../../Scrapers/Pipeline/PipelineBuilder.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Minimal ScraperOptions for testing. */
const MOCK_OPTIONS = {
  companyId: 'test' as never,
  startDate: new Date('2024-01-01'),
} as never;

/** Minimal ILoginConfig stub. */
const MOCK_LOGIN_CONFIG: ILoginConfig = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent', value: 'Login' },
  possibleResults: {},
} as never;

/** Minimal OTP config. */
const MOCK_OTP_CONFIG: OtpConfig = 'sms' as never;

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
    if (!descriptor.success) return;
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('scrape');
  });
});

describe('PipelineBuilder/resolveLoginStep-branches', () => {
  it('uses DECLARATIVE_LOGIN_STEP when OTP config with ILoginConfig', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtp(MOCK_OTP_CONFIG)
      .build();
    if (!descriptor.success) return;
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
    expect(names).toContain('otp');
  });

  it('uses LOGIN_STEPS map for directPost login mode', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .build();
    if (!descriptor.success) return;
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
  });

  it('executes the adapted fn when withDeclarativeLogin receives a function', async () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_DIRECT_LOGIN)
      .build();
    if (!descriptor.success) return;
    const loginPhase = descriptor.value.phases[0];
    expect(loginPhase.action.name).toBe('declarative-login');
    const mockCtx = { credentials: { user: 'test' } } as never;
    const result = await loginPhase.action.execute(mockCtx, mockCtx);
    expect(result.success).toBe(true);
  });

  it('uses fn-adapted step when withDeclarativeLogin(fn) + OTP', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_DIRECT_LOGIN)
      .withOtp(MOCK_OTP_CONFIG)
      .build();
    if (!descriptor.success) return;
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
    expect(names).toContain('otp');
  });

  it('uses LOGIN_STEPS map for native login mode', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    if (!descriptor.success) return;
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
  });
});
