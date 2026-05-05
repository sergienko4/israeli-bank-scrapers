/**
 * Unit tests for Core/Executor/PipelineFinalizer — runAfterPipeline hook dispatch.
 */

import { runAfterPipeline } from '../../../../../Scrapers/Pipeline/Core/Executor/PipelineFinalizer.js';
import type { IPipelineInterceptor } from '../../../../../Scrapers/Pipeline/Types/Interceptor.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Test helper.
   *
   * @param message - Parameter.
   * @returns Result.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

describe('Feature — AfterPipeline', () => {
  it('returns 0 when interceptor list is empty', async () => {
    const makeMockContextResult1 = makeMockContext();
    const count = await runAfterPipeline([], makeMockContextResult1);
    expect(count).toBe(0);
  });

  it('returns 0 when no interceptor exposes afterPipeline', async () => {
    const interceptors: IPipelineInterceptor[] = [
      {
        name: 'noop-1',
      } as unknown as IPipelineInterceptor,
      {
        name: 'noop-2',
      } as unknown as IPipelineInterceptor,
    ];
    const makeMockContextResult2 = makeMockContext();
    const count = await runAfterPipeline(interceptors, makeMockContextResult2);
    expect(count).toBe(0);
  });

  it('runs every afterPipeline hook and returns the count', async () => {
    let callsA = 0;
    let callsB = 0;
    const interceptors: IPipelineInterceptor[] = [
      {
        name: 'a',
        /**
         * Finalizer A.
         * @returns Resolved.
         */
        afterPipeline: async (): Promise<void> => {
          await Promise.resolve();
          callsA += 1;
        },
      } as unknown as IPipelineInterceptor,
      {
        name: 'b',
        /**
         * Finalizer B.
         * @returns Resolved.
         */
        afterPipeline: async (): Promise<void> => {
          await Promise.resolve();
          callsB += 1;
        },
      } as unknown as IPipelineInterceptor,
    ];
    const makeMockContextResult3 = makeMockContext();
    const count = await runAfterPipeline(interceptors, makeMockContextResult3);
    expect(count).toBe(2);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);
  });

  it('swallows errors thrown inside afterPipeline (best-effort)', async () => {
    let wasOtherCalled = false;
    const interceptors: IPipelineInterceptor[] = [
      {
        name: 'thrower',
        /**
         * Finalizer that throws.
         * @returns Rejected.
         */
        afterPipeline: async (): Promise<void> => {
          await Promise.resolve();
          throw new TestError('boom');
        },
      } as unknown as IPipelineInterceptor,
      {
        name: 'sibling',
        /**
         * Finalizer that records.
         * @returns Resolved.
         */
        afterPipeline: async (): Promise<void> => {
          await Promise.resolve();
          wasOtherCalled = true;
        },
      } as unknown as IPipelineInterceptor,
    ];
    const makeMockContextResult4 = makeMockContext();
    const count = await runAfterPipeline(interceptors, makeMockContextResult4);
    expect(count).toBe(2);
    expect(wasOtherCalled).toBe(true);
  });
});
