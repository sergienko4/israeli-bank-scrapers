/**
 * Firing tests for the narrow INIT error-document no-retry guard
 * ({@link reducePhases} via isNonRetryable).
 *
 * When the bank's edge serves its own error document under a healthy
 * HTTP status, INIT fails attributably. That failure must not be pulsed:
 * re-running INIT re-enters the non-idempotent browser launch, and the
 * tracker's last context predates the phase, so the browser the retry
 * creates has no owner left to dispose it. The evidence also says the
 * condition clears in minutes rather than seconds, so an immediate
 * second attempt buys nothing.
 *
 * The guard is deliberately narrow. Every OTHER init failure keeps its
 * retry so a transient WAF challenge can still clear on the pulse.
 *
 * Each case drives the exported reducePhases over a single failing phase
 * and counts how many times that phase's run is invoked: 1 = no retry,
 * 2 = retried once via the sanitization pulse.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { reducePhases } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineReducer.js';
import { errorDocumentMessage } from '../../../../Scrapers/Pipeline/Mediator/Init/LandingDocument.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Phases/Base/BasePhase.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from './MockFactories.js';

/** Generous per-test budget: each reducePhases incurs one ~4s PRE settle. */
const RETRY_TEST_TIMEOUT_MS = 20_000;

/**
 * The real error-document failure, built through the production message
 * factory so the test fails if the stable code stops being front-loaded.
 * @returns Failure carrying the error-document code.
 */
function makeErrorDocumentFailure(): Procedure<IPipelineContext> {
  const message = errorDocumentMessage('https://www.example-bank.co.il/');
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Build a phase stub whose run always returns the given failure, backed
 * by a jest mock so its invocation count is assertable.
 * @param name - Phase name exposed as step.name.
 * @param failure - The failure each run returns.
 * @returns The BasePhase stub paired with its run spy.
 */
function makeFailingPhase(
  name: PhaseName,
  failure: Procedure<IPipelineContext>,
): { phase: BasePhase; run: jest.Mock } {
  const run = jest.fn((): Promise<Procedure<IPipelineContext>> => Promise.resolve(failure));
  return { phase: { name, run } as unknown as BasePhase, run };
}

/**
 * Drive reducePhases over a single failing phase and return the run spy.
 * @param name - Phase name.
 * @param failure - Failure the phase returns on every invocation.
 * @returns The run spy (assert its call count).
 */
async function driveReducer(
  name: PhaseName,
  failure: Procedure<IPipelineContext>,
): Promise<jest.Mock> {
  const ctx = makeMockContext();
  const { phase, run } = makeFailingPhase(name, failure);
  const tracker = { phases: [phase], interceptors: [], lastCtx: ctx };
  await reducePhases(tracker, ctx, 0);
  return run;
}

describe('PipelineReducer — narrow init error-document no-retry', () => {
  it(
    'does NOT retry init on the error-document fail code',
    async () => {
      const failure = makeErrorDocumentFailure();
      const run = await driveReducer('init', failure);
      expect(run).toHaveBeenCalledTimes(1);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'still retries init on an unrelated failure',
    async () => {
      const failure = fail(ScraperErrorTypes.Generic, 'INIT FINAL: no DOM');
      const run = await driveReducer('init', failure);
      expect(run).toHaveBeenCalledTimes(2);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'still retries a non-init phase carrying the error-document code',
    async () => {
      const failure = makeErrorDocumentFailure();
      const run = await driveReducer('dashboard', failure);
      expect(run).toHaveBeenCalledTimes(2);
    },
    RETRY_TEST_TIMEOUT_MS,
  );
});
