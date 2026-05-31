/**
 * Branch recovery tests for PipelineSanitizationPulse.
 * Targets:
 *  - line 55 path 0: interceptor failure short-circuits pulse.
 *  - line 58 path 1: retry succeeds after interceptor re-run.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { sanitizationPulse } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineSanitizationPulse.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import type { IPipelineInterceptor } from '../../../../Scrapers/Pipeline/Types/Interceptor.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockBrowserState } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext } from './MockFactories.js';

/**
 * Build a minimal BasePhase stub with scripted run outcome.
 * @param outcome - Scripted outcome.
 * @returns Result.
 */
function makePhaseStub(outcome: 'ok' | 'fail'): BasePhase {
  return {
    name: 'home',
    /**
     * Test helper.
     *
     * @param ctx - Pipeline context.
     * @returns Result.
     */
    run: (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> =>
      Promise.resolve(
        outcome === 'ok' ? succeed(ctx) : fail(ScraperErrorTypes.Generic, 'retry failed'),
      ),
  } as unknown as BasePhase;
}

/**
 * Build a minimal interceptor chain with scripted before-phase outcome.
 * @param outcome - Scripted outcome.
 * @returns Result.
 */
function makeInterceptorStub(outcome: 'ok' | 'fail'): IPipelineInterceptor {
  return {
    /**
     * Test helper.
     *
     * @param ctx - Pipeline context.
     * @returns Result.
     */
    beforePhase: (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> =>
      Promise.resolve(
        outcome === 'ok' ? succeed(ctx) : fail(ScraperErrorTypes.Generic, 'interceptor failed'),
      ),
    /**
     * Test helper.
     *
     * @returns Result.
     */
    afterPipeline: (): Promise<Procedure<IPipelineContext>> => {
      const ok = succeed({} as IPipelineContext);
      return Promise.resolve(ok);
    },
  } as unknown as IPipelineInterceptor;
}

describe('PipelineSanitizationPulse — branch recovery', () => {
  it('returns false when interceptor fails during pulse (line 55 path 0)', async () => {
    const browser = makeMockBrowserState();
    const ctx = makeMockContext({ browser: some(browser) });
    const tracker = {
      phases: [makePhaseStub('ok')] as readonly BasePhase[],
      interceptors: [makeInterceptorStub('fail')] as readonly IPipelineInterceptor[],
      lastCtx: ctx,
    };
    const step = { name: 'home' as const, tag: '1/1', index: 0 };
    const result = await sanitizationPulse({ tracker, ctx, step });
    expect(result).toBe(false);
  });

  it('returns recovered context when interceptor + retry both succeed (line 58 path 1)', async () => {
    const browser = makeMockBrowserState();
    const ctx = makeMockContext({ browser: some(browser) });
    const tracker = {
      phases: [makePhaseStub('ok')] as readonly BasePhase[],
      interceptors: [makeInterceptorStub('ok')] as readonly IPipelineInterceptor[],
      lastCtx: ctx,
    };
    const step = { name: 'home' as const, tag: '1/1', index: 0 };
    const result = await sanitizationPulse({ tracker, ctx, step });
    // When the retry succeeds, sanitizationPulse returns the recovered context value.
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.diagnostics).toBeDefined();
    }
  });

  it('returns false when interceptor succeeds but retry fails', async () => {
    const browser = makeMockBrowserState();
    const ctx = makeMockContext({ browser: some(browser) });
    const tracker = {
      phases: [makePhaseStub('fail')] as readonly BasePhase[],
      interceptors: [makeInterceptorStub('ok')] as readonly IPipelineInterceptor[],
      lastCtx: ctx,
    };
    const step = { name: 'home' as const, tag: '1/1', index: 0 };
    const result = await sanitizationPulse({ tracker, ctx, step });
    expect(result).toBe(false);
  });
});
