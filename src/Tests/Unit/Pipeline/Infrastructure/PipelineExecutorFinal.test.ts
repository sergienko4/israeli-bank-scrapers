/**
 * Unit tests for PipelineExecutor — FINAL step (4th stage of the phase protocol).
 * Verifies: final runs after post, final failure propagates, final skipped when none().
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { SimplePhase } from '../../../../Scrapers/Pipeline/Types/SimplePhase.js';

type Ctx = IActionContext;
type FullCtx = IPipelineContext;

/** Minimal ScraperOptions. */
const MOCK_OPTIONS = {
  companyId: 'beinleumi',
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;

/** Minimal credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

/**
 * Succeed-and-passthrough execute function.
 * @param _ctx - Action context (unused).
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
  return await executePipeline(descriptor, MOCK_CREDENTIALS);
}

describe('PipelineExecutor/final-step', () => {
  it('runs final step after post when present', async () => {
    let didFinalRun = false;
    /** Phase with a final step. */
    class FinalPhase extends SimplePhase {
      /**
       * Final step that tracks execution.
       * @param _ctx - Context (unused).
       * @param input - Input.
       * @returns Succeed with input.
       */
      public override final(_ctx: FullCtx, input: FullCtx): Promise<Procedure<FullCtx>> {
        didFinalRun = true;
        const result = succeed(input);
        return Promise.resolve(result);
      }
    }
    const phase = new FinalPhase('login', succeedExecute);
    const descriptor: IPipelineDescriptor = {
      options: MOCK_OPTIONS,
      phases: [phase],
      interceptors: [],
    };
    const result = await run(descriptor);
    expect(result.success).toBe(true);
    expect(didFinalRun).toBe(true);
  });

  it('propagates final step failure', async () => {
    /** Phase with failing final. */
    class FailFinalPhase extends SimplePhase {
      /**
       * Failing final step.
       * @returns Failure.
       */
      public override final(): Promise<Procedure<FullCtx>> {
        const result = fail(ScraperErrorTypes.Generic, 'readiness timeout');
        return Promise.resolve(result);
      }
    }
    const phase = new FailFinalPhase('home', succeedExecute);
    const descriptor: IPipelineDescriptor = {
      options: MOCK_OPTIONS,
      phases: [phase],
      interceptors: [],
    };
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('readiness timeout');
  });

  it('skips final when default no-op (BasePhase default)', async () => {
    const phase = new SimplePhase('init', succeedExecute);
    const descriptor: IPipelineDescriptor = {
      options: MOCK_OPTIONS,
      phases: [phase],
      interceptors: [],
    };
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});
