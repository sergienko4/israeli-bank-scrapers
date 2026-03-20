import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/PipelineDescriptor.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/PipelineExecutor.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPhaseDefinition } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Minimal ScraperOptions. */
const MOCK_OPTIONS = {
  companyId: 'test',
  startDate: new Date('2024-01-01'),
} as never;

/** Minimal credentials. */
const MOCK_CREDENTIALS = {
  username: 'user',
  password: 'pass',
};

type Ctx = IPipelineContext;
type Phase = IPhaseDefinition<Ctx, Ctx>;
type ExecFn = (_ctx: Ctx, _input: Ctx) => Promise<Procedure<Ctx>>;

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
 * Create a phase that succeeds and passes context through.
 * @param name - Phase name.
 * @returns A succeeding phase definition.
 */
function succeedPhase(name: Phase['name']): Phase {
  return {
    name,
    pre: none(),
    action: { name: `${name}-action`, execute: succeedExecute },
    post: none(),
  };
}

/**
 * Create a phase that fails with a given message.
 * @param name - Phase name.
 * @param message - Error message.
 * @returns A failing phase definition.
 */
function failPhase(name: Phase['name'], message: string): Phase {
  const executeFn = makeFailExecute(ScraperErrorTypes.Generic, message);
  return {
    name,
    pre: none(),
    action: { name: `${name}-action`, execute: executeFn },
    post: none(),
  };
}

/**
 * Create a descriptor with the given phases.
 * @param phases - Phase definitions.
 * @returns A pipeline descriptor.
 */
function makeDescriptor(phases: Phase[]): IPipelineDescriptor {
  return { options: MOCK_OPTIONS, phases };
}

/**
 * Run pipeline and return the result.
 * @param descriptor - Pipeline descriptor.
 * @returns The scraping result.
 */
async function run(descriptor: IPipelineDescriptor): ReturnType<typeof executePipeline> {
  return executePipeline(descriptor, MOCK_CREDENTIALS);
}

describe('PipelineExecutor/empty-pipeline', () => {
  it('returns success with no phases', async () => {
    const descriptor = makeDescriptor([]);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});

describe('PipelineExecutor/single-phase', () => {
  it('runs one phase and returns success', async () => {
    const phases = [succeedPhase('login')];
    const descriptor = makeDescriptor(phases);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});

describe('PipelineExecutor/multi-phase', () => {
  it('runs all 3 phases and returns success', async () => {
    const phases = [succeedPhase('init'), succeedPhase('login'), succeedPhase('scrape')];
    const descriptor = makeDescriptor(phases);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});

describe('PipelineExecutor/short-circuit', () => {
  it('skips phase 3 when phase 2 fails', async () => {
    let didPhase3Run = false;
    /**
     * Tracks execution and succeeds.
     * @param _ctx - Pipeline context (unused).
     * @param input - Input passed through.
     * @returns A resolved success procedure.
     */
    const trackExecute = (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
      didPhase3Run = true;
      const result = succeed(input);
      return Promise.resolve(result);
    };
    const phase3: Phase = {
      name: 'scrape',
      pre: none(),
      action: { name: 'scrape-action', execute: trackExecute },
      post: none(),
    };
    const phases = [succeedPhase('init'), failPhase('login', 'bad creds'), phase3];
    const descriptor = makeDescriptor(phases);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('bad creds');
    expect(didPhase3Run).toBe(false);
  });
});

describe('PipelineExecutor/pre-failure', () => {
  it('skips action and post when pre fails', async () => {
    let didActionRun = false;
    /**
     * Tracks action execution and succeeds.
     * @param _ctx - Pipeline context (unused).
     * @param input - Input passed through.
     * @returns A resolved success procedure.
     */
    const trackAction = (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
      didActionRun = true;
      const result = succeed(input);
      return Promise.resolve(result);
    };
    const preExec = makeFailExecute(ScraperErrorTypes.Timeout, 'pre timeout');
    const phase: Phase = {
      name: 'login',
      pre: some({ name: 'login-pre', execute: preExec }),
      action: { name: 'login-action', execute: trackAction },
      post: none(),
    };
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Timeout);
    expect(didActionRun).toBe(false);
  });
});

describe('PipelineExecutor/post-failure', () => {
  it('propagates post step failure', async () => {
    const postExec = makeFailExecute(ScraperErrorTypes.ChangePassword, 'must change');
    const phase: Phase = {
      name: 'login',
      pre: none(),
      action: { name: 'login-action', execute: succeedExecute },
      post: some({ name: 'login-post', execute: postExec }),
    };
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });
});

describe('PipelineExecutor/exception-handling', () => {
  it('catches thrown exception and wraps in failure', async () => {
    /**
     * Throws an unexpected error.
     * @returns Never resolves normally.
     */
    const throwExecute = (): never => {
      throw new ScraperError('unexpected crash');
    };
    const phase: Phase = {
      name: 'login',
      pre: none(),
      action: { name: 'login-action', execute: throwExecute },
      post: none(),
    };
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(result.errorMessage).toBe('unexpected crash');
  });
});

describe('PipelineExecutor/pre-success-passthrough', () => {
  it('pre step passes context to action', async () => {
    const phase: Phase = {
      name: 'init',
      pre: some({ name: 'init-pre', execute: succeedExecute }),
      action: { name: 'init-action', execute: succeedExecute },
      post: some({ name: 'init-post', execute: succeedExecute }),
    };
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});

describe('PipelineExecutor/returns-promise', () => {
  it('returns a Promise', () => {
    const descriptor = makeDescriptor([]);
    const promise = executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(promise).toBeInstanceOf(Promise);
  });
});

describe('PipelineExecutor/wrapError', () => {
  it('catches phase that throws Error and returns failure', async () => {
    const throwPhase: Phase = {
      name: 'login',
      pre: none(),
      action: {
        name: 'login-action',
        /**
         * Throws an Error to test wrapError.
         * @returns Never — always throws.
         */
        execute: (): Promise<Procedure<Ctx>> => {
          throw new ScraperError('crash!');
        },
      },
      post: none(),
    };
    const descriptor = makeDescriptor([throwPhase]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('crash!');
  });

  it('produces "Unknown pipeline error" when thrown value has empty message', async () => {
    const throwPhase: Phase = {
      name: 'scrape',
      pre: none(),
      action: {
        name: 'scrape-action',
        /**
         * Throws an Error with empty message.
         * @returns Never — always throws.
         */
        execute: (): Promise<Procedure<Ctx>> => {
          throw new ScraperError('');
        },
      },
      post: none(),
    };
    const descriptor = makeDescriptor([throwPhase]);
    const result = await run(descriptor);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Unknown pipeline error');
  });
});

describe('PipelineExecutor/persistentOtpToken', () => {
  it('includes persistentOtpToken in result when login state has it', async () => {
    /**
     * Set login.persistentOtpToken in context.
     * @param _ctx - Pipeline context (unused).
     * @param input - Input to extend with OTP token.
     * @returns Context with persistentOtpToken set.
     */
    const setOtpExecute = (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
      const loginState = { activeFrame: {} as never, persistentOtpToken: some('TOKEN123') };
      const result = succeed({ ...input, login: some(loginState) });
      return Promise.resolve(result);
    };
    const phase: Phase = {
      name: 'login',
      pre: none(),
      action: { name: 'login-action', execute: setOtpExecute },
      post: none(),
    };
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
    expect(result.persistentOtpToken).toBe('TOKEN123');
  });
});
