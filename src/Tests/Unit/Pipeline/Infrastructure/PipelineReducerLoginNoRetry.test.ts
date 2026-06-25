/**
 * Firing tests for the narrow login no-retry guard (isNonRetryable).
 *
 * The login auth-confirm timeout sentinel must NOT trigger the
 * sanitization-pulse retry: re-submitting credentials cannot rescue a
 * stalled auth and just masks the real failure (the Amex SPA stall).
 * Every OTHER login failure (incl. WAF challenges) and every other
 * phase keeps its retry. NO_RETRY phases (api-direct-*) never retry.
 *
 * Each case drives the exported reducePhases over a single failing
 * phase and counts how many times that phase's run is invoked:
 * 1 = no retry, 2 = retried once via the sanitization pulse.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { reducePhases } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineReducer.js';
import { LOGIN_POST_AUTH_CONFIRM_TIMEOUT } from '../../../../Scrapers/Pipeline/Mediator/Login/PostValidate/PostValidateGates.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from './MockFactories.js';

/** Generous per-test budget: each reducePhases incurs one ~4s PRE settle. */
const RETRY_TEST_TIMEOUT_MS = 20_000;

/**
 * Build a phase stub whose run always fails with the given Procedure,
 * backed by a jest mock so its invocation count is assertable.
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
 * @returns The run spy (assert call count on it).
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

describe('PipelineReducer — narrow login no-retry', () => {
  it(
    'does NOT retry login on the auth-confirm timeout sentinel',
    async () => {
      const failure = fail(ScraperErrorTypes.Timeout, LOGIN_POST_AUTH_CONFIRM_TIMEOUT);
      const run = await driveReducer('login', failure);
      expect(run).toHaveBeenCalledTimes(1);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'still retries login on any other timeout message',
    async () => {
      const failure = fail(ScraperErrorTypes.Timeout, 'LOGIN.POST: waitForLoadingDone timed out');
      const run = await driveReducer('login', failure);
      expect(run).toHaveBeenCalledTimes(2);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'still retries a non-login phase carrying the sentinel message',
    async () => {
      const failure = fail(ScraperErrorTypes.Timeout, LOGIN_POST_AUTH_CONFIRM_TIMEOUT);
      const run = await driveReducer('home', failure);
      expect(run).toHaveBeenCalledTimes(2);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'never retries a NO_RETRY api-direct phase',
    async () => {
      const failure = fail(ScraperErrorTypes.Generic, 'api-direct-call failed');
      const run = await driveReducer('api-direct-call', failure);
      expect(run).toHaveBeenCalledTimes(1);
    },
    RETRY_TEST_TIMEOUT_MS,
  );
});
