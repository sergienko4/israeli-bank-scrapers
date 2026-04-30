/**
 * Unit tests for Mediator/Terminate/TerminateActions — cleanup LIFO + stamping.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import {
  executeLogResults,
  executeRunCleanups,
  executeRunCleanupsFromContext,
  executeSignalDone,
  executeStartCleanup,
  runAllCleanups,
} from '../../../../Scrapers/Pipeline/Mediator/Terminate/TerminateActions.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IBrowserState } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockBrowserState,
  makeMockContext,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeFlushableLogger } from './TestHelpers.js';

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

describe('executeStartCleanup', () => {
  it('passes through context unchanged', async () => {
    const ctx = makeMockContext();
    const result = await executeStartCleanup(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });
});

describe('executeRunCleanups (ACTION)', () => {
  it('succeeds when no browser (no-op)', async () => {
    const ctx = makeMockContext({ browser: none() });
    // Cast the full pipeline ctx as IActionContext at runtime — TERMINATE's
    // action expects IActionContext but the TERMINATE path uses it as
    // IBootstrapContext (browser still available).
    const actionCtx = ctx as unknown as Parameters<typeof executeRunCleanups>[0];
    const result = await executeRunCleanups(actionCtx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('runs cleanups in LIFO order when browser present', async () => {
    const order: number[] = [];
    const cleanups: IBrowserState['cleanups'] = [
      (): Promise<Procedure<void>> => {
        order.push(1);
        const succeedResult3 = succeed(undefined);
        return Promise.resolve(succeedResult3);
      },
      (): Promise<Procedure<void>> => {
        order.push(2);
        const succeedResult4 = succeed(undefined);
        return Promise.resolve(succeedResult4);
      },
      (): Promise<Procedure<void>> => {
        order.push(3);
        const succeedResult5 = succeed(undefined);
        return Promise.resolve(succeedResult5);
      },
    ];
    const browserState = makeMockBrowserState(undefined, cleanups);
    const ctx = makeMockContext({ browser: some(browserState) });
    const actionCtx = ctx as unknown as Parameters<typeof executeRunCleanups>[0];
    await executeRunCleanups(actionCtx);
    expect(order).toEqual([3, 2, 1]);
  });
});

describe('executeRunCleanupsFromContext (POST)', () => {
  it('runs cleanups on full pipeline context', async () => {
    let called = 0;
    const cleanups: IBrowserState['cleanups'] = [
      (): Promise<Procedure<void>> => {
        called += 1;
        const succeedResult6 = succeed(undefined);
        return Promise.resolve(succeedResult6);
      },
    ];
    const browserState = makeMockBrowserState(undefined, cleanups);
    const ctx = makeMockContext({ browser: some(browserState) });
    const result = await executeRunCleanupsFromContext(ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
    expect(called).toBe(1);
  });

  it('handles a failing cleanup without crashing pipeline', async () => {
    const cleanups: IBrowserState['cleanups'] = [
      (): Promise<Procedure<void>> => {
        const failBoom = fail(ScraperErrorTypes.Generic, 'boom');
        return Promise.resolve(failBoom);
      },
      (): Promise<Procedure<void>> => {
        const okVoid = succeed(undefined);
        return Promise.resolve(okVoid);
      },
    ];
    const browserState = makeMockBrowserState(undefined, cleanups);
    const ctx = makeMockContext({ browser: some(browserState) });
    const result = await executeRunCleanupsFromContext(ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('handles a throwing cleanup without crashing pipeline', async () => {
    const cleanups: IBrowserState['cleanups'] = [
      (): Promise<Procedure<void>> => {
        throw new TestError('explode');
      },
    ];
    const browserState = makeMockBrowserState(undefined, cleanups);
    const ctx = makeMockContext({ browser: some(browserState) });
    const result = await executeRunCleanupsFromContext(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('passes through when no browser', async () => {
    const ctx = makeMockContext({ browser: none() });
    const result = await executeRunCleanupsFromContext(ctx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });
});

describe('executeLogResults / executeSignalDone', () => {
  it('executeLogResults stamps "terminate-post" diag', async () => {
    const ctx = makeMockContext();
    const result = await executeLogResults(ctx);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toBe('terminate-post');
    }
  });

  it('executeSignalDone stamps "terminate-done" diag', async () => {
    const ctx = makeMockContext();
    const result = await executeSignalDone(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toBe('terminate-done');
    }
  });
});

describe('Feature — AllCleanups helper', () => {
  it('runs all and returns count', async () => {
    const log = makeFlushableLogger();
    const cleanups: IBrowserState['cleanups'] = [
      (): Promise<Procedure<void>> => {
        const okVoid = succeed(undefined);
        return Promise.resolve(okVoid);
      },
      (): Promise<Procedure<void>> => {
        const okVoid = succeed(undefined);
        return Promise.resolve(okVoid);
      },
    ];
    const count = await runAllCleanups(cleanups, log);
    expect(count).toBe(2);
  });

  it('empty cleanups returns 0', async () => {
    const log = makeFlushableLogger();
    const count = await runAllCleanups([], log);
    expect(count).toBe(0);
  });
});
