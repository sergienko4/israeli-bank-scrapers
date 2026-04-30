/**
 * Unit tests for Interceptors/MockInterceptor — env gating + route install.
 */

import type { BrowserContext, Page } from 'playwright-core';

import {
  createMockInterceptor,
  isMockEnabled,
} from '../../../../Scrapers/Pipeline/Interceptors/MockInterceptor.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

const UNSET_SENTINEL = '__UNSET__';

/**
 * Utility to toggle MOCK_MODE env safely.
 * @param value - New value (UNSET_SENTINEL to delete).
 * @param fn - Test body.
 * @returns Resolves true after restore.
 */
function withMockEnv(value: string, fn: () => unknown): Promise<boolean> {
  const prior = process.env.MOCK_MODE ?? UNSET_SENTINEL;
  if (value === UNSET_SENTINEL) delete process.env.MOCK_MODE;
  else process.env.MOCK_MODE = value;
  /**
   * Restore previous env value.
   * @returns True after restore.
   */
  const restore = (): boolean => {
    if (prior === UNSET_SENTINEL) delete process.env.MOCK_MODE;
    else process.env.MOCK_MODE = prior;
    return true;
  };
  const fnResult1 = fn();
  return Promise.resolve(fnResult1)
    .then(restore)
    .catch((err: unknown): never => {
      restore();
      throw err;
    });
}

/**
 * Build a context object with a route fn and a reload-capable page.
 * @returns Tuple of [context, routeCalls, reloads].
 */
function makeBrowserBundle(): {
  ctx: BrowserContext;
  page: Page;
  routeCalls: number;
  reloadCalls: number;
} {
  let routeCalls = 0;
  let reloadCalls = 0;
  const page = {
    /**
     * reload.
     * @returns Resolved response.
     */
    reload: (): Promise<boolean> => {
      reloadCalls += 1;
      return Promise.resolve(true);
    },
  } as unknown as Page;
  const ctx = {
    /**
     * route — stores handler count.
     * @returns Resolves.
     */
    route: (): Promise<void> => {
      routeCalls += 1;
      return Promise.resolve();
    },
  } as unknown as BrowserContext;
  return {
    ctx,
    page,
    /**
     * Test helper.
     *
     * @returns Result.
     */
    get routeCalls(): number {
      return routeCalls;
    },
    /**
     * Test helper.
     *
     * @returns Result.
     */
    get reloadCalls(): number {
      return reloadCalls;
    },
  };
}

describe('isMockEnabled', () => {
  it('returns false without env', async () => {
    await withMockEnv(UNSET_SENTINEL, (): boolean => {
      const isMockEnabledResult2 = isMockEnabled();
      expect(isMockEnabledResult2).toBe(false);
      return true;
    });
  });
  it('returns true when MOCK_MODE=1', async () => {
    await withMockEnv('1', (): boolean => {
      const isMockEnabledResult3 = isMockEnabled();
      expect(isMockEnabledResult3).toBe(true);
      return true;
    });
  });
  it('returns true when MOCK_MODE=true', async () => {
    await withMockEnv('true', (): boolean => {
      const isMockEnabledResult4 = isMockEnabled();
      expect(isMockEnabledResult4).toBe(true);
      return true;
    });
  });
});

describe('createMockInterceptor', () => {
  it('returns disabled interceptor when MOCK_MODE unset', async () => {
    await withMockEnv(UNSET_SENTINEL, async (): Promise<boolean> => {
      const i = createMockInterceptor();
      expect(i.name).toContain('disabled');
      const ctx = makeMockContext();
      const result = await i.beforePhase(ctx, 'home');
      expect(result).toBeDefined();
      const isOkResult5 = isOk(result);
      expect(isOkResult5).toBe(true);
      return true;
    });
  });

  it('returns active interceptor when MOCK_MODE=1', async () => {
    await withMockEnv('1', (): boolean => {
      const i = createMockInterceptor();
      expect(i.name).toBe('MockInterceptor');
      expect(typeof i.beforePhase).toBe('function');
      return true;
    });
  });

  it('active interceptor returns ctx even when browser is absent', async () => {
    await withMockEnv('1', async (): Promise<boolean> => {
      const i = createMockInterceptor();
      const ctx = makeMockContext({ browser: none() });
      const result = await i.beforePhase(ctx, 'home');
      expect(result).toBeDefined();
      const isOkResult6 = isOk(result);
      expect(isOkResult6).toBe(true);
      return true;
    });
  });

  it('active interceptor registers context.route when browser present', async () => {
    await withMockEnv('1', async (): Promise<boolean> => {
      const i = createMockInterceptor();
      const bundle = makeBrowserBundle();
      const base = makeMockContext();
      const now = Date.now();
      const nowStr = String(now);
      const ctx: IPipelineContext = {
        ...base,
        companyId: `mock-if-${nowStr}` as unknown as IPipelineContext['companyId'],
        browser: some({
          browser: {},
          context: bundle.ctx,
          page: bundle.page,
        }) as unknown as IPipelineContext['browser'],
      };
      const result = await i.beforePhase(ctx, 'home');
      expect(result).toBeDefined();
      const isOkResult7 = isOk(result);
      expect(isOkResult7).toBe(true);
      expect(bundle.routeCalls).toBeGreaterThan(0);
      return true;
    });
  });

  it('active interceptor reloads for otp-fill phase', async () => {
    await withMockEnv('1', async (): Promise<boolean> => {
      const i = createMockInterceptor();
      const bundle = makeBrowserBundle();
      const base = makeMockContext();
      const now = Date.now();
      const nowStr = String(now);
      const ctx: IPipelineContext = {
        ...base,
        companyId: `mock-if-otp-${nowStr}` as unknown as IPipelineContext['companyId'],
        browser: some({
          browser: {},
          context: bundle.ctx,
          page: bundle.page,
        }) as unknown as IPipelineContext['browser'],
      };
      await i.beforePhase(ctx, 'otp-fill');
      expect(bundle.reloadCalls).toBeGreaterThan(0);
      return true;
    });
  });

  it('active interceptor swallows reload rejection for otp-fill phase', async () => {
    await withMockEnv('1', async (): Promise<boolean> => {
      const i = createMockInterceptor();
      const rejectingPage = {
        /**
         * reload that rejects.
         * @returns Rejected promise.
         */
        reload: (): Promise<never> => Promise.reject(new Error('nav failure')),
      } as unknown as Page;
      const rejectingCtx = {
        /**
         * route stub.
         * @returns Resolved.
         */
        route: (): Promise<void> => Promise.resolve(),
      } as unknown as BrowserContext;
      const base = makeMockContext();
      const now = Date.now();
      const nowStr = String(now);
      const ctx: IPipelineContext = {
        ...base,
        companyId: `mock-if-otp-fail-${nowStr}` as unknown as IPipelineContext['companyId'],
        browser: some({
          browser: {},
          context: rejectingCtx,
          page: rejectingPage,
        }) as unknown as IPipelineContext['browser'],
      };
      const result = await i.beforePhase(ctx, 'otp-fill');
      expect(result).toBeDefined();
      const isOkResult8 = isOk(result);
      expect(isOkResult8).toBe(true);
      return true;
    });
  });

  it('active interceptor reuses existing route (isRouted=true branch)', async () => {
    await withMockEnv('1', async (): Promise<boolean> => {
      const i = createMockInterceptor();
      const bundle = makeBrowserBundle();
      const base = makeMockContext();
      const now = Date.now();
      const nowStr = String(now);
      const companyId = `mock-if-reuse-${nowStr}` as unknown as IPipelineContext['companyId'];
      const ctx: IPipelineContext = {
        ...base,
        companyId,
        browser: some({
          browser: {},
          context: bundle.ctx,
          page: bundle.page,
        }) as unknown as IPipelineContext['browser'],
      };
      await i.beforePhase(ctx, 'home');
      const firstRouteCount = bundle.routeCalls;
      await i.beforePhase(ctx, 'login');
      expect(bundle.routeCalls).toBe(firstRouteCount);
      return true;
    });
  });
});
