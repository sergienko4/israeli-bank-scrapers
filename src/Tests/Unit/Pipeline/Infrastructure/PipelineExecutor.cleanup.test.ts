/**
 * Unit tests for PipelineExecutor — API mediator disposal.
 * Verifies the mediator's owned resources are released even when a phase fails or throws.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { IApiMediator } from '../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Phases/Base/BasePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { SimplePhase } from './SimplePhase.js';

/** Minimal ScraperOptions for cleanup tests. */
const MOCK_OPTIONS = {
  companyId: 'beinleumi',
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;

/** Minimal credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

type Ctx = IActionContext;
type ExecFn = (_ctx: Ctx, _input: Ctx) => Promise<Procedure<Ctx>>;
type DisposeFn = () => Promise<void>;

/**
 * Create a phase that installs a mediator whose dispose is the given function.
 * @param dispose - Dispose hook the executor must call during cleanup.
 * @returns A phase that puts the mediator on the context.
 */
function makeMediatorPhase(dispose: DisposeFn): SimplePhase {
  /**
   * Install the mediator.
   * @param _ctx - Pipeline context (unused).
   * @param input - Input context to extend.
   * @returns Context carrying the mediator.
   */
  const executeFn: ExecFn = (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
    const mediator = { dispose } as unknown as IApiMediator;
    const result = succeed({ ...input, apiMediator: some(mediator) });
    return Promise.resolve(result);
  };
  return new SimplePhase('api-direct-call', executeFn);
}

/**
 * Create a failing SimplePhase.
 * @param message - Error message.
 * @returns A failing SimplePhase.
 */
function failPhase(message: string): SimplePhase {
  /**
   * Return a failure procedure.
   * @returns Resolved failure.
   */
  const executeFn: ExecFn = (): Promise<Procedure<Ctx>> => {
    const result = fail(ScraperErrorTypes.Generic, message);
    return Promise.resolve(result);
  };
  return new SimplePhase('api-direct-scrape', executeFn);
}

/**
 * Create a throwing SimplePhase.
 * @param message - Error message.
 * @returns A throwing SimplePhase.
 */
function throwPhase(message: string): SimplePhase {
  /**
   * Always throws.
   * @returns Never.
   */
  const executeFn = (): Promise<Procedure<Ctx>> => {
    throw new ScraperError(message);
  };
  return new SimplePhase('api-direct-scrape', executeFn);
}

/**
 * Run the pipeline built from the given phases.
 * @param phases - BasePhase instances.
 * @returns Scraping result.
 */
async function run(phases: BasePhase[]): ReturnType<typeof executePipeline> {
  const descriptor: IPipelineDescriptor = { options: MOCK_OPTIONS, phases, isHeadless: false };
  return await executePipeline(descriptor, MOCK_CREDENTIALS);
}

describe('PipelineExecutor/mediator-dispose', () => {
  it('disposes the mediator when a later phase fails', async () => {
    const dispose = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const result = await run([makeMediatorPhase(dispose), failPhase('bad creds')]);
    expect(result.success).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the mediator and wraps the error when a later phase throws', async () => {
    const dispose = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const result = await run([makeMediatorPhase(dispose), throwPhase('unexpected crash')]);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('unexpected crash');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('preserves the original error when dispose itself rejects', async () => {
    const dispose = jest.fn<Promise<void>, []>().mockRejectedValue(new Error('socket already closed'));
    const result = await run([makeMediatorPhase(dispose), failPhase('invalid password')]);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('invalid password');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineExecutor/no-mediator-no-dispose', () => {
  it('fails cleanly when no phase installed a mediator', async () => {
    const result = await run([failPhase('no mediator')]);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('no mediator');
  });
});
