/**
 * Unit tests for PipelineExecutor — browser cleanup on failure.
 * Verifies that browser resources are always cleaned up, even when phases fail or throw.
 */

import { jest } from '@jest/globals';
import type { BrowserContext, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/Core/PipelineExecutor.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { SimplePhase } from '../../../../Scrapers/Pipeline/Types/SimplePhase.js';

/** Minimal ScraperOptions for cleanup tests. */
const MOCK_OPTIONS = {
  companyId: 'test',
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;

/** Minimal credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

type Ctx = IPipelineContext;
type ExecFn = (_ctx: Ctx, _input: Ctx) => Promise<Procedure<Ctx>>;

/**
 * Succeed-and-passthrough execute.
 * @param _ctx - Pipeline context (unused).
 * @param input - Input passed through.
 * @returns Resolved success procedure.
 */
function succeedExecute(_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/**
 * Create a succeeding SimplePhase.
 * @param name - Phase name.
 * @returns A succeeding SimplePhase.
 */
function succeedPhase(name: PhaseName): SimplePhase {
  return new SimplePhase(name, succeedExecute);
}

/**
 * Create a failing SimplePhase.
 * @param name - Phase name.
 * @param message - Error message.
 * @returns A failing SimplePhase.
 */
function failPhase(name: PhaseName, message: string): SimplePhase {
  /**
   * Return a failure procedure.
   * @returns Resolved failure.
   */
  const executeFn: ExecFn = (): Promise<Procedure<Ctx>> => {
    const result = fail(ScraperErrorTypes.Generic, message);
    return Promise.resolve(result);
  };
  return new SimplePhase(name, executeFn);
}

/**
 * Create a throwing SimplePhase.
 * @param name - Phase name.
 * @param message - Error message.
 * @returns A throwing SimplePhase.
 */
function throwPhase(name: PhaseName, message: string): SimplePhase {
  /**
   * Always throws.
   * @returns Never.
   */
  const executeFn = (): Promise<Procedure<Ctx>> => {
    throw new ScraperError(message);
  };
  return new SimplePhase(name, executeFn);
}

/**
 * Create a descriptor from phases.
 * @param phases - BasePhase instances.
 * @returns Pipeline descriptor.
 */
function makeDescriptor(phases: BasePhase[]): IPipelineDescriptor {
  return { options: MOCK_OPTIONS, phases, interceptors: [] };
}

/**
 * Run pipeline with default credentials.
 * @param descriptor - Pipeline descriptor.
 * @returns Scraping result.
 */
async function run(descriptor: IPipelineDescriptor): ReturnType<typeof executePipeline> {
  return await executePipeline(descriptor, MOCK_CREDENTIALS);
}

/**
 * Create an INIT SimplePhase that wires mock browser state with spy cleanups.
 * @param spies - Jest mock functions used as cleanup handlers.
 * @returns SimplePhase that sets browser state with the provided spy cleanups.
 */
function makeInitWithSpyCleanups(spies: jest.Mock[]): SimplePhase {
  /**
   * Wire browser state with spy cleanups into context.
   * @param _ctx - Pipeline context (unused).
   * @param input - Input context to extend.
   * @returns Context with browser state containing spy cleanups.
   */
  const executeFn: ExecFn = (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
    const cleanups: IBrowserState['cleanups'] = spies.map(
      (spy): IBrowserState['cleanups'][number] =>
        (): Promise<Procedure<void>> => {
          spy();
          const done = succeed(undefined);
          return Promise.resolve(done);
        },
    );
    const state: IBrowserState = {
      page: {} as unknown as Page,
      context: {} as unknown as BrowserContext,
      cleanups,
    };
    const result = succeed({ ...input, browser: some(state) });
    return Promise.resolve(result);
  };
  return new SimplePhase('init', executeFn);
}

// ── Tests ───────────────────────────────────────────────────

describe('PipelineExecutor/cleanup-on-phase-failure', () => {
  it('runs browser cleanup when LOGIN phase fails', async () => {
    const spy0 = jest.fn();
    const spy1 = jest.fn();
    const spy2 = jest.fn();
    const initPhase = makeInitWithSpyCleanups([spy0, spy1, spy2]);
    const phases = [initPhase, failPhase('login', 'bad creds')];
    const descriptor = makeDescriptor(phases);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(spy0).toHaveBeenCalled();
    expect(spy1).toHaveBeenCalled();
    expect(spy2).toHaveBeenCalled();
  });

  it('runs browser cleanup when HOME phase fails', async () => {
    const spy0 = jest.fn();
    const initPhase = makeInitWithSpyCleanups([spy0]);
    const descriptor = makeDescriptor([initPhase, failPhase('home', 'home nav failed')]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(spy0).toHaveBeenCalled();
  });

  it('runs browser cleanup when SCRAPE phase fails', async () => {
    const spy0 = jest.fn();
    const initPhase = makeInitWithSpyCleanups([spy0]);
    const phases = [
      initPhase,
      succeedPhase('home'),
      succeedPhase('login'),
      failPhase('scrape', 'scrape error'),
    ];
    const descriptor = makeDescriptor(phases);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(spy0).toHaveBeenCalled();
  });

  it('runs browser cleanup when phase throws exception', async () => {
    const spy0 = jest.fn();
    const initPhase = makeInitWithSpyCleanups([spy0]);
    const descriptor = makeDescriptor([initPhase, throwPhase('login', 'unexpected crash')]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('unexpected crash');
    expect(spy0).toHaveBeenCalled();
  });

  it('preserves original error message after cleanup', async () => {
    const spy0 = jest.fn();
    const initPhase = makeInitWithSpyCleanups([spy0]);
    const descriptor = makeDescriptor([initPhase, failPhase('login', 'invalid password')]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('invalid password');
  });
});

describe('PipelineExecutor/cleanup-idempotent-on-success', () => {
  it('does not crash when cleanup runs after successful TERMINATE', async () => {
    const spy0 = jest.fn().mockResolvedValue(true);
    const initPhase = makeInitWithSpyCleanups([spy0]);
    /**
     * Mock TERMINATE — runs cleanups then succeeds.
     * @param _ctx - Pipeline context (unused).
     * @param input - Input context with browser state.
     * @returns Succeed after running cleanups.
     */
    const terminateExecute: ExecFn = async (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
      if (!input.browser.has) return succeed(input);
      const cleanups = input.browser.value.cleanups;
      const promises = cleanups.map((fn): Promise<Procedure<void>> => fn());
      await Promise.all(promises);
      return succeed(input);
    };
    const terminatePhase = new SimplePhase('terminate', terminateExecute);
    const phases = [initPhase, succeedPhase('login'), terminatePhase];
    const descriptor = makeDescriptor(phases);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});

describe('PipelineExecutor/no-browser-no-cleanup', () => {
  it('skips cleanup when no INIT phase exists', async () => {
    const descriptor = makeDescriptor([failPhase('login', 'no browser')]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('no browser');
  });

  it('skips cleanup when INIT itself fails', async () => {
    const descriptor = makeDescriptor([failPhase('init', 'browser launch failed')]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('browser launch failed');
  });
});
