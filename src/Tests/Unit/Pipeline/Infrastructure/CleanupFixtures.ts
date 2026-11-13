/**
 * Executor fixtures shared by the cleanup-diagnostic suites: phases that install,
 * pass through or fail around a mediator whose `dispose` the test controls.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { IApiMediator } from '../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { SimplePhase } from './SimplePhase.js';

const OPTIONS = {
  companyId: 'beinleumi',
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;
const CREDENTIALS = { username: 'user', password: 'pass' };
const SECRET = 'bearer-token-9f8e7d6c5b4a';

type Ctx = IActionContext;
type ExecFn = (_ctx: Ctx, _input: Ctx) => Promise<Procedure<Ctx>>;
type DisposeFn = () => Promise<void>;

/**
 * An error carrying a secret in its message and a well-formed cause code.
 * @returns The error.
 */
function leakyDisposalError(): Error {
  const error = new ScraperError(`socket to https://bank.example?token=${SECRET} reset`);
  Object.defineProperty(error, 'cause', { value: { code: 'ECONNRESET' } });
  return error;
}

/**
 * A phase that installs a mediator whose dispose is the given function.
 * @param dispose - The dispose hook the executor must call.
 * @returns A phase that installs the mediator.
 */
function mediatorPhase(dispose: DisposeFn): SimplePhase {
  const mediator = { dispose } as unknown as IApiMediator;
  /**
   * Install the mediator on the context.
   * @param _ctx - Unused.
   * @param input - The context to extend.
   * @returns A context carrying the mediator.
   */
  const install: ExecFn = (_ctx, input) => {
    const slot = some(mediator);
    const next = succeed({ ...input, apiMediator: slot });
    return Promise.resolve(next);
  };
  return new SimplePhase('api-direct-call', install);
}

/**
 * A later phase that passes the context through, so the mediator-installing
 * phase is not the last one.
 * @returns The phase.
 */
function passThroughPhase(): SimplePhase {
  /**
   * Pass the context through.
   * @param _ctx - Unused.
   * @param input - The context.
   * @returns The same context.
   */
  const pass: ExecFn = (_ctx, input) => {
    const next = succeed(input);
    return Promise.resolve(next);
  };
  return new SimplePhase('api-direct-scrape', pass);
}

/**
 * A later phase that fails.
 * @returns The phase.
 */
function failingPhase(): SimplePhase {
  /**
   * Return a failure.
   * @returns A failed procedure.
   */
  const fails: ExecFn = () => {
    const failure = fail(ScraperErrorTypes.Generic, 'scrape failed');
    return Promise.resolve(failure);
  };
  return new SimplePhase('api-direct-scrape', fails);
}

/**
 * A dispose hook that rejects with a secret-bearing error.
 * @returns The hook, as a spy.
 */
function rejectingDispose(): jest.Mock<Promise<void>, []> {
  const error = leakyDisposalError();
  return jest.fn<Promise<void>, []>().mockRejectedValue(error);
}

/**
 * A dispose hook that resolves.
 * @returns The hook, as a spy.
 */
function resolvingDispose(): jest.Mock<Promise<void>, []> {
  return jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
}

/**
 * Run a pipeline of the given phases.
 * @param phases - The phases.
 * @returns The scraping result.
 */
function run(phases: SimplePhase[]): ReturnType<typeof executePipeline> {
  const descriptor: IPipelineDescriptor = { options: OPTIONS, phases };
  return executePipeline(descriptor, CREDENTIALS);
}

export type { DisposeFn, ExecFn };
export {
  failingPhase,
  leakyDisposalError,
  mediatorPhase,
  passThroughPhase,
  rejectingDispose,
  resolvingDispose,
  run,
  SECRET,
};
