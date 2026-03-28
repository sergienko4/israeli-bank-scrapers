import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/PipelineDescriptor.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/PipelineExecutor.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { SimplePhase } from '../../../../Scrapers/Pipeline/Types/SimplePhase.js';

/** Minimal ScraperOptions. */
const MOCK_OPTIONS = {
  companyId: 'test',
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;

/** Minimal credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

type Ctx = IPipelineContext;
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
  return { options: MOCK_OPTIONS, phases, interceptors: [] };
}

/**
 * Run pipeline with default credentials.
 * @param descriptor - Pipeline descriptor.
 * @returns Scraping result.
 */
async function run(descriptor: IPipelineDescriptor): ReturnType<typeof executePipeline> {
  return executePipeline(descriptor, MOCK_CREDENTIALS);
}

// ── Basic pipeline flow ──────────────────────────────────

describe('PipelineExecutor/basic-flow', () => {
  it('runs all phases sequentially and returns success', async () => {
    const phases = [succeedPhase('init'), succeedPhase('login'), succeedPhase('scrape')];
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
    const phase3 = new SimplePhase('scrape', trackExecute);
    const phases = [succeedPhase('init'), failPhase('login', 'bad creds'), phase3];
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
    const preExec = makeFailExecute(ScraperErrorTypes.Timeout, 'pre timeout');
    /** Phase with failing pre. */
    class PreFailPhase extends SimplePhase {
      /**
       * Failing pre step.
       * @param ctx - Context.
       * @param input - Input.
       * @returns Failure.
       */
      public async pre(ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> {
        return preExec(ctx, input);
      }
    }
    const phase = new PreFailPhase('login', trackAction);
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
    const postExec = makeFailExecute(ScraperErrorTypes.ChangePassword, 'must change');
    /** Phase with failing post. */
    class PostFailPhase extends SimplePhase {
      /**
       * Failing post step.
       * @param ctx - Context.
       * @param input - Input.
       * @returns Failure.
       */
      public async post(ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> {
        return postExec(ctx, input);
      }
    }
    const phase = new PostFailPhase('login', succeedExecute);
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
    const phase = new SimplePhase('login', throwExecute);
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
    const phase = succeedPhase('init');
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
  });
});

// ── Returns promise ──────────────────────────────────────

describe('PipelineExecutor/returns-promise', () => {
  it('returns a Promise', () => {
    const descriptor = makeDescriptor([]);
    const promise = executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(promise).toBeInstanceOf(Promise);
  });
});

// ── OTP token ────────────────────────────────────────────

describe('PipelineExecutor/persistentOtpToken', () => {
  it('includes persistentOtpToken in result when login state has it', async () => {
    /**
     * Set login.persistentOtpToken in context.
     * @param _ctx - Pipeline context (unused).
     * @param input - Input to extend with OTP token.
     * @returns Context with persistentOtpToken set.
     */
    const setOtpExecute = (_ctx: Ctx, input: Ctx): Promise<Procedure<Ctx>> => {
      const loginState = {
        activeFrame: {} as unknown as Page,
        persistentOtpToken: some('TOKEN123'),
      };
      const result = succeed({ ...input, login: some(loginState) });
      return Promise.resolve(result);
    };
    const phase = new SimplePhase('login', setOtpExecute);
    const descriptor = makeDescriptor([phase]);
    const result = await run(descriptor);
    expect(result.success).toBe(true);
    expect(result.persistentOtpToken).toBe('TOKEN123');
  });
});
