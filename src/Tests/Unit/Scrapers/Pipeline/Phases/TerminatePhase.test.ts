/**
 * Unit tests for TerminatePhase.ts.
 * Covers LIFO cleanup order, error swallowing, no-browser guard.
 */

import { jest } from '@jest/globals';

import type { ScraperLogger } from '../../../../../Common/Debug.js';
import {
  runAllCleanups,
  TERMINATE_STEP,
} from '../../../../../Scrapers/Pipeline/Phases/TerminatePhase.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { makeMockBrowserState, makeMockContext } from '../MockPipelineFactories.js';

// ── Helpers ────────────────────────────────────────────────

/**
 * Build a context with a specific set of cleanup functions.
 * @param cleanups - Cleanup functions to attach.
 * @returns Context with browser:some(state) containing those cleanups.
 */
function makeCtxWithCleanups(
  cleanups: readonly (() => Promise<boolean>)[],
): ReturnType<typeof makeMockContext> {
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
    const cleanups = [
      (): Promise<boolean> => {
        order.push(0);
        return Promise.resolve(true);
      },
      (): Promise<boolean> => {
        order.push(1);
        return Promise.resolve(true);
      },
      (): Promise<boolean> => {
        order.push(2);
        return Promise.resolve(true);
      },
    ];
    const ctx = makeCtxWithCleanups(cleanups);
    await TERMINATE_STEP.execute(ctx, ctx);
    expect(order).toEqual([2, 1, 0]);
  });

  it('returns succeed(input) after all cleanups', async () => {
    const cleanups = [
      (): Promise<boolean> => Promise.resolve(true),
      (): Promise<boolean> => Promise.resolve(true),
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
    const cleanups = [(): Promise<boolean> => Promise.reject(new Error('close failed'))];
    const ctx = makeCtxWithCleanups(cleanups);
    const result = await TERMINATE_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
  });

  it('calls logger.debug when cleanup throws', async () => {
    const cleanups = [(): Promise<boolean> => Promise.reject(new Error('page close error'))];
    const ctx = makeCtxWithCleanups(cleanups);
    await TERMINATE_STEP.execute(ctx, ctx);
    const logger = ctx.logger as unknown as { debug: jest.Mock };
    expect(logger.debug).toHaveBeenCalled();
  });

  it('continues remaining cleanups after one throws', async () => {
    const order: number[] = [];
    const cleanups = [
      (): Promise<boolean> => {
        order.push(0);
        return Promise.resolve(true);
      },
      (): Promise<boolean> => Promise.reject(new Error('fail at 1')),
      (): Promise<boolean> => {
        order.push(2);
        return Promise.resolve(true);
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
    const cleanups = [
      (): Promise<boolean> => {
        order.push(0);
        return Promise.resolve(true);
      },
      (): Promise<boolean> => {
        order.push(1);
        return Promise.resolve(true);
      },
      (): Promise<boolean> => {
        order.push(2);
        return Promise.resolve(true);
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
    const cleanups = [
      (): Promise<boolean> => Promise.resolve(true),
      (): Promise<boolean> => Promise.reject(new Error('middle fails')),
      (): Promise<boolean> => Promise.resolve(true),
    ];
    const logger = makeMockLogger();
    const count = await runAllCleanups(cleanups, logger);
    expect(count).toBe(2);
  });
});
