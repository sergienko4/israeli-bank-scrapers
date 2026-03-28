/**
 * Unit tests for TerminatePhase.ts.
 * Covers LIFO cleanup order, error swallowing, no-browser guard.
 */

import { jest } from '@jest/globals';

import {
  runAllCleanups,
  TERMINATE_STEP,
} from '../../../../../Scrapers/Pipeline/Phases/TerminatePhase.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IBrowserState } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockBrowserState, makeMockContext, SUCCEED_VOID } from '../MockPipelineFactories.js';

/** Shorthand for cleanup function type. */
type CleanupFn = IBrowserState['cleanups'][number];

// ── Helpers ────────────────────────────────────────────────

/**
 * Build a context with a specific set of cleanup functions.
 * @param cleanups - Cleanup functions to attach.
 * @returns Context with browser:some(state) containing those cleanups.
 */
function makeCtxWithCleanups(cleanups: readonly CleanupFn[]): ReturnType<typeof makeMockContext> {
  const browserState = makeMockBrowserState(undefined, cleanups);
  const logger = {
    debug: jest.fn(),
    trace: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return makeMockContext({
    browser: some(browserState),
    logger: logger as unknown as ScraperLogger,
  });
}

// ── Tests ─────────────────────────────────────────────────

describe('TERMINATE_STEP', () => {
  it('has name "terminate"', () => {
    expect(TERMINATE_STEP.name).toBe('terminate');
  });
});

describe('TerminatePhase/no-browser', () => {
  it('returns succeed(input) immediately when browser is none()', async () => {
    const ctx = makeMockContext();
    const result = await TERMINATE_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(ctx);
  });
});

describe('TerminatePhase/cleanup-order', () => {
  it('runs cleanups in LIFO order (last registered runs first)', async () => {
    const order: number[] = [];
    const cleanups: CleanupFn[] = [
      (): Promise<Procedure<void>> => {
        order.push(0);
        return SUCCEED_VOID;
      },
      (): Promise<Procedure<void>> => {
        order.push(1);
        return SUCCEED_VOID;
      },
      (): Promise<Procedure<void>> => {
        order.push(2);
        return SUCCEED_VOID;
      },
    ];
    const ctx = makeCtxWithCleanups(cleanups);
    await TERMINATE_STEP.execute(ctx, ctx);
    expect(order).toEqual([2, 1, 0]);
  });

  it('returns succeed(input) after all cleanups', async () => {
    const cleanups: CleanupFn[] = [
      (): Promise<Procedure<void>> => SUCCEED_VOID,
      (): Promise<Procedure<void>> => SUCCEED_VOID,
    ];
    const ctx = makeCtxWithCleanups(cleanups);
    const result = await TERMINATE_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
  });

  it('handles zero cleanups — returns succeed immediately', async () => {
    const ctx = makeCtxWithCleanups([]);
    const result = await TERMINATE_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
  });
});

describe('TerminatePhase/error-swallowing', () => {
  it('swallows cleanup errors and returns succeed', async () => {
    const cleanups: CleanupFn[] = [
      (): Promise<Procedure<void>> => Promise.reject(new Error('close failed')),
    ];
    const ctx = makeCtxWithCleanups(cleanups);
    const result = await TERMINATE_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
  });

  it('calls logger.debug when cleanup throws', async () => {
    const cleanups: CleanupFn[] = [
      (): Promise<Procedure<void>> => Promise.reject(new Error('page close error')),
    ];
    const ctx = makeCtxWithCleanups(cleanups);
    await TERMINATE_STEP.execute(ctx, ctx);
    const logger = ctx.logger as unknown as { debug: jest.Mock };
    expect(logger.debug).toHaveBeenCalled();
  });

  it('continues remaining cleanups after one throws', async () => {
    const order: number[] = [];
    const cleanups: CleanupFn[] = [
      (): Promise<Procedure<void>> => {
        order.push(0);
        return SUCCEED_VOID;
      },
      (): Promise<Procedure<void>> => Promise.reject(new Error('fail at 1')),
      (): Promise<Procedure<void>> => {
        order.push(2);
        return SUCCEED_VOID;
      },
    ];
    const ctx = makeCtxWithCleanups(cleanups);
    const result = await TERMINATE_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
    expect(order).toContain(0);
    expect(order).toContain(2);
  });
});

// ── runAllCleanups (exported for PipelineExecutor emergency cleanup) ──

/**
 * Build a mock logger for runAllCleanups tests.
 * @returns Logger with jest.fn() stubs.
 */
function makeMockLogger(): ScraperLogger {
  return {
    debug: jest.fn(),
    trace: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as ScraperLogger;
}

describe('TerminatePhase/runAllCleanups', () => {
  it('runs cleanups in LIFO order', async () => {
    const order: number[] = [];
    const cleanups: CleanupFn[] = [
      (): Promise<Procedure<void>> => {
        order.push(0);
        return SUCCEED_VOID;
      },
      (): Promise<Procedure<void>> => {
        order.push(1);
        return SUCCEED_VOID;
      },
      (): Promise<Procedure<void>> => {
        order.push(2);
        return SUCCEED_VOID;
      },
    ];
    const logger = makeMockLogger();
    await runAllCleanups(cleanups, logger);
    expect(order).toEqual([2, 1, 0]);
  });

  it('returns 0 for empty cleanups array', async () => {
    const logger = makeMockLogger();
    const count = await runAllCleanups([], logger);
    expect(count).toBe(0);
  });

  it('returns count of successful cleanups (skipping failures)', async () => {
    const cleanups: CleanupFn[] = [
      (): Promise<Procedure<void>> => SUCCEED_VOID,
      (): Promise<Procedure<void>> => Promise.reject(new Error('middle fails')),
      (): Promise<Procedure<void>> => SUCCEED_VOID,
    ];
    const logger = makeMockLogger();
    const count = await runAllCleanups(cleanups, logger);
    expect(count).toBe(2);
  });
});
