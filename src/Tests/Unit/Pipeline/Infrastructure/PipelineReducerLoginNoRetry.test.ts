/**
 * Firing tests for the narrow login no-retry guard
 * ({@link reducePhases} via isNonRetryable).
 *
 * A perpetually-spinning login screen never clears the form; re-submitting
 * would re-fire the credential XHR and could kill an in-flight auth. One
 * honest try is enough when the login-completion poll exhausts its budget
 * without the form leaving the screen.
 *
 * Every OTHER login failure (e.g. wrong password / InvalidPassword) keeps
 * its retry so a transient WAF challenge can still clear on the pulse.
 *
 * Each case drives the exported reducePhases over a single failing phase
 * and counts how many times that phase's run is invoked: 1 = no retry,
 * 2 = retried once via the sanitization pulse.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { reducePhases } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineReducer.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import { LOGIN_NOT_COMPLETED_CODE } from '../../../../Scrapers/Pipeline/Types/Domain/LoginTypes.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from './MockFactories.js';

/** Generous per-test budget: each reducePhases incurs one ~4s PRE settle. */
const RETRY_TEST_TIMEOUT_MS = 20_000;

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

describe('PipelineReducer — narrow login no-retry', () => {
  it(
    'does NOT retry login on the not-completed fail code',
    async () => {
      const msg = `${LOGIN_NOT_COMPLETED_CODE} — login form still present after 15 attempts (75000ms)`;
      const failure = fail(ScraperErrorTypes.Generic, msg);
      const run = await driveReducer('login', failure);
      expect(run).toHaveBeenCalledTimes(1);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'still retries login on a different failure (e.g. wrong password)',
    async () => {
      const failure = fail(ScraperErrorTypes.Generic, 'InvalidPassword — wrong credentials');
      const run = await driveReducer('login', failure);
      expect(run).toHaveBeenCalledTimes(2);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'still retries a non-login phase carrying the not-completed code',
    async () => {
      const msg = `${LOGIN_NOT_COMPLETED_CODE} — login form still present after 15 attempts (75000ms)`;
      const failure = fail(ScraperErrorTypes.Generic, msg);
      const run = await driveReducer('home', failure);
      expect(run).toHaveBeenCalledTimes(2);
    },
    RETRY_TEST_TIMEOUT_MS,
  );
});
