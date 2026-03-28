/**
 * Unit tests for PipelineExecutor — FINAL step (4th stage of the phase protocol).
 * Verifies: final runs after post, final failure propagates, final skipped when none().
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/PipelineDescriptor.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/PipelineExecutor.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { SimplePhase } from '../../../../Scrapers/Pipeline/Types/SimplePhase.js';

type Ctx = IPipelineContext;

/** Minimal ScraperOptions. */
const MOCK_OPTIONS = {
  companyId: 'test',
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;

/** Minimal credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

/**
 * Succeed-and-passthrough execute function.
 * @param _ctx - Pipeline context (unused).
 * @param input - Input passed through.
 * @returns A resolved success procedure.
 */
function succeedExecute(_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/**
 * Run pipeline with default credentials.
 * @param descriptor - Pipeline descriptor.
 * @returns Scraping result.
 */
async function run(descriptor: IPipelineDescriptor): ReturnType<typeof executePipeline> {
  return executePipeline(descriptor, MOCK_CREDENTIALS);
}

describe('PipelineExecutor/final-step', () => {
  it('runs final step after post when present', async () => {
    let didFinalRun = false;
    /**
     * Track final step execution and succeed.
     * @param _ctx - Unused context.
     * @param input - Pipeline context.
     * @returns Succeed with input.
     */
    const finalExec = (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
      didFinalRun = true;
      const result = succeed(input);
      return Promise.resolve(result);
    };
    /** Phase with a final step. */
    class FinalPhase extends SimplePhase {
      /**
       * Final step that tracks execution.
       * @param ctx - Context.
       * @param input - Input.
       * @returns Succeed with tracked flag.
       */
      public async final(ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> {
        return finalExec(ctx, input);
      }
    }
    const phase = new FinalPhase('login', succeedExecute);
    const descriptor: IPipelineDescriptor = { options: MOCK_OPTIONS, phases: [phase] };
    const result = await run(descriptor);
    expect(result.success).toBe(true);
    expect(didFinalRun).toBe(true);
  });

  it('propagates final step failure', async () => {
    /**
     * Return a failure procedure.
     * @returns Failure with readiness timeout.
     */
    const finalExec = (): Promise<Procedure<Ctx>> => {
      const result = fail(ScraperErrorTypes.Generic, 'readiness timeout');
      return Promise.resolve(result);
    };
    /** Phase with failing final. */
    class FailFinalPhase extends SimplePhase {
      /**
       * Failing final step.
       * @returns Failure.
       */
      public async final(): Promise<Procedure<Ctx>> {
        return finalExec();
      }
    }
    const phase = new FailFinalPhase('home', succeedExecute);
    const descriptor: IPipelineDescriptor = { options: MOCK_OPTIONS, phases: [phase] };
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('readiness timeout');
  });

  it('skips final when default no-op (BasePhase default)', async () => {
    const phase = new SimplePhase('init', succeedExecute);
    const descriptor: IPipelineDescriptor = { options: MOCK_OPTIONS, phases: [phase] };
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});
