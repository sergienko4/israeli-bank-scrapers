import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import executePipeline from '../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type BasePhase from '../../../../Scrapers/Pipeline/Phases/Base/BasePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type PhaseName from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { SimplePhase } from './SimplePhase.js';

/** Minimal ScraperOptions. */
const MOCK_OPTIONS = {
  companyId: 'beinleumi',
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;

/** Minimal credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

type Ctx = IActionContext;
type FullCtx = IPipelineContext;
type ExecFn = (_ctx: Ctx, _input: Ctx) => Promise<Procedure<Ctx>>;

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
 * Create a failing execute for a given error type and message.
 * @param errorType - The scraper error type.
 * @param message - Error message.
 * @returns An execute function that resolves to failure.
 */
function makeFailExecute(errorType: ScraperErrorTypes, message: string): ExecFn {
  return (): Promise<Procedure<Ctx>> => {
    const result = fail(errorType, message);
    return Promise.resolve(result);
  };
}

/**
 * Create a SimplePhase that succeeds and passes context through.
 * @param name - Phase name.
 * @returns A succeeding SimplePhase.
 */
function succeedPhase(name: PhaseName): SimplePhase {
  return new SimplePhase(name, succeedExecute);
}

/**
 * Create a SimplePhase that fails with a given message.
 * @param name - Phase name.
 * @param message - Error message.
 * @returns A failing SimplePhase.
 */
function failPhase(name: PhaseName, message: string): SimplePhase {
  const executeFn = makeFailExecute(ScraperErrorTypes.Generic, message);
  return new SimplePhase(name, executeFn);
}

/**
 * Create a descriptor with the given phases.
 * @param phases - BasePhase instances.
 * @returns A pipeline descriptor.
 */
function makeDescriptor(phases: BasePhase[]): IPipelineDescriptor {
  return { options: MOCK_OPTIONS, phases };
}

/**
 * Run pipeline with default credentials.
 * @param descriptor - Pipeline descriptor.
 * @returns Scraping result.
 */
async function run(descriptor: IPipelineDescriptor): ReturnType<typeof executePipeline> {
  return await executePipeline(descriptor, MOCK_CREDENTIALS);
}

// ── Basic pipeline flow ──────────────────────────────────

describe('PipelineExecutor/basic-flow', () => {
  it('runs all phases sequentially and returns success', async () => {
    const phases = [
      succeedPhase('api-direct-call'),
      succeedPhase('api-direct-call'),
      succeedPhase('api-direct-scrape'),
    ];
    const descriptor = makeDescriptor(phases);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });

  it('returns success for empty phase list', async () => {
    const descriptor = makeDescriptor([]);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});

// ── Phase failure short-circuit ──────────────────────────

describe('PipelineExecutor/short-circuit', () => {
  it('stops on first failure and skips subsequent phases', async () => {
    let didPhase3Run = false;
    /**
     * Track execution of phase 3.
     * @param _ctx - Pipeline context (unused).
     * @param input - Input to pass through.
     * @returns Succeed with input.
     */
    const trackExecute: ExecFn = (_ctx, input) => {
      didPhase3Run = true;
      const result = succeed(input);
      return Promise.resolve(result);
    };
    const phase3 = new SimplePhase('api-direct-scrape', trackExecute);
    const phases = [
      succeedPhase('api-direct-call'),
      failPhase('api-direct-call', 'bad creds'),
      phase3,
    ];
    const descriptor = makeDescriptor(phases);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('bad creds');
    expect(didPhase3Run).toBe(false);
  });
});

// ── Pre-failure ──────────────────────────────────────────

describe('PipelineExecutor/pre-failure', () => {
  it('skips action and post when pre fails', async () => {
    let didActionRun = false;
    /**
     * Track action execution.
     * @param _ctx - Pipeline context (unused).
     * @param input - Input to pass through.
     * @returns Succeed with input.
     */
    const trackAction: ExecFn = (_ctx, input) => {
      didActionRun = true;
      const result = succeed(input);
      return Promise.resolve(result);
    };
    /** Phase with failing pre. */
    class PreFailPhase extends SimplePhase {
      /**
       * Failing pre step.
       * @returns Failure.
       */
      public override pre(): Promise<Procedure<FullCtx>> {
        const result = fail(ScraperErrorTypes.Timeout, 'pre timeout');
        return Promise.resolve(result);
      }
    }
    const phase = new PreFailPhase('api-direct-call', trackAction);
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
    expect(didActionRun).toBe(false);
  });
});

// ── Post-failure ─────────────────────────────────────────

describe('PipelineExecutor/post-failure', () => {
  it('propagates post step failure', async () => {
    /** Phase with failing post. */
    class PostFailPhase extends SimplePhase {
      /**
       * Failing post step.
       * @returns Failure.
       */
      public override post(): Promise<Procedure<FullCtx>> {
        const result = fail(ScraperErrorTypes.ChangePassword, 'must change');
        return Promise.resolve(result);
      }
    }
    const phase = new PostFailPhase('api-direct-call', succeedExecute);
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });
});

// ── Exception handling ───────────────────────────────────

describe('PipelineExecutor/exception-handling', () => {
  it('catches thrown exception and wraps in failure', async () => {
    /**
     * Throws an unexpected error.
     * @returns Never resolves normally.
     */
    const throwExecute = (): never => {
      throw new ScraperError('unexpected crash');
    };
    const phase = new SimplePhase('api-direct-call', throwExecute);
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(result.errorMessage).toBe('unexpected crash');
  });
});

// ── Pre success passthrough ──────────────────────────────

describe('PipelineExecutor/pre-success-passthrough', () => {
  it('pre step passes context to action (default no-ops)', async () => {
    const phase = succeedPhase('api-direct-call');
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});

// ── Returns promise ──────────────────────────────────────

describe('PipelineExecutor/returns-promise', () => {
  it('returns a Promise', async () => {
    const descriptor = makeDescriptor([]);
    const result = await executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(result).toBeDefined();
  });
});

// ── registerOrFail ───────────────────────────────────────

describe('PipelineExecutor/registerOrFail', () => {
  it('throws ScraperError when companyId is not a known TraceConfig slug', async () => {
    const badOptions = { companyId: 'not-a-real-bank', startDate: new Date('2024-01-01') };
    const descriptor: IPipelineDescriptor = {
      options: badOptions as unknown as ScraperOptions,
      phases: [],
    };
    let caught: unknown = null;
    try {
      await executePipeline(descriptor, MOCK_CREDENTIALS);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/No run without bank/);
  });
});

// ── OTP token ────────────────────────────────────────────

describe('PipelineExecutor/persistentOtpToken', () => {
  it('includes persistentOtpToken in result when durable auth state has it', async () => {
    /**
     * Set durableAuth.persistentOtpToken in context.
     * @param _ctx - Pipeline context (unused).
     * @param input - Input to extend with OTP token.
     * @returns Context with durableAuth set.
     */
    const setOtpExecute = (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
      const durableAuth = some({ persistentOtpToken: 'TOKEN123' });
      const result = succeed({ ...input, durableAuth });
      return Promise.resolve(result);
    };
    const phase = new SimplePhase('api-direct-call', setOtpExecute);
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
    expect(result.persistentOtpToken).toBe('TOKEN123');
  });
});

/**
 * Wait for an abort signal rather than a manual timer.
 * @param ms - Delay in milliseconds.
 * @returns Resolves when the timeout signal fires.
 */
async function afterDelay(ms: number): Promise<void> {
  const signal = AbortSignal.timeout(ms);
  await new Promise<void>(resolve => {
    signal.addEventListener(
      'abort',
      (): boolean => {
        resolve();
        return true;
      },
      { once: true },
    );
  });
}

describe('PipelineExecutor/cancellation', () => {
  it('stops before the first phase when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let didPhaseRun = false;
    const phase = new SimplePhase('api-direct-call', (_ctx, input) => {
      didPhaseRun = true;
      const result = succeed(input);
      return Promise.resolve(result);
    });
    const options = { ...MOCK_OPTIONS, signal: controller.signal };
    const result = await executePipeline({ options, phases: [phase] }, MOCK_CREDENTIALS);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Timeout,
    });
    expect(didPhaseRun).toBe(false);
  });

  it('reports cancellation when a phase fails after the abort', async () => {
    const controller = new AbortController();
    const phase = new SimplePhase('api-direct-call', () => {
      controller.abort();
      const result = fail(ScraperErrorTypes.Generic, 'phase failed');
      return Promise.resolve(result);
    });
    const options = { ...MOCK_OPTIONS, signal: controller.signal };
    const result = await executePipeline({ options, phases: [phase] }, MOCK_CREDENTIALS);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Timeout,
    });
  });

  it('reports cancellation even when the final phase returns success', async () => {
    const controller = new AbortController();
    const phase = new SimplePhase('api-direct-call', (_ctx, input) => {
      controller.abort();
      const result = succeed(input);
      return Promise.resolve(result);
    });
    const options = { ...MOCK_OPTIONS, signal: controller.signal };
    const result = await executePipeline({ options, phases: [phase] }, MOCK_CREDENTIALS);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Timeout,
    });
  });

  it.each([-1, Number.NaN])('ignores an unusable deadline %s', async deadlineMs => {
    const options = { ...MOCK_OPTIONS, deadlineMs };
    const result = await executePipeline({ options, phases: [] }, MOCK_CREDENTIALS);
    expect(result.success).toBe(true);
  });

  it('accepts a fractional deadline without throwing', async () => {
    const options = { ...MOCK_OPTIONS, deadlineMs: 1.5 };
    const result = await executePipeline({ options, phases: [] }, MOCK_CREDENTIALS);
    expect(result.success).toBe(true);
  });

  it('stops before the next phase once the run deadline passes', async () => {
    let didSecondPhaseRun = false;
    const slow = new SimplePhase('api-direct-call', async (_ctx, input) => {
      await afterDelay(20);
      return succeed(input);
    });
    const second = new SimplePhase('api-direct-scrape', (_ctx, input) => {
      didSecondPhaseRun = true;
      const result = succeed(input);
      return Promise.resolve(result);
    });
    const options = { ...MOCK_OPTIONS, deadlineMs: 5 };
    const result = await executePipeline({ options, phases: [slow, second] }, MOCK_CREDENTIALS);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Timeout,
    });
    expect(didSecondPhaseRun).toBe(false);
  });
});
