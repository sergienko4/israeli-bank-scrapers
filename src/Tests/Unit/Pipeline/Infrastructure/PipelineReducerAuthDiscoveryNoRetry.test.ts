/**
 * Firing tests for the narrow auth-discovery no-retry guard
 * ({@link reducePhases} via isNonRetryable).
 *
 * AUTH-DISCOVERY's honest "dashboard not ready" failure means the page
 * is still stuck on the login form. Re-running auth-discovery only
 * re-reads the same stuck page (no re-submit, no navigation), so the
 * sanitization-pulse retry cannot rescue it — one honest try is enough.
 * Every OTHER auth-discovery failure (e.g. AUTH_DISCOVERY_SESSION_INVALID)
 * keeps its retry so a transient WAF challenge can still clear on the pulse.
 *
 * Each case drives the exported reducePhases over a single failing phase
 * and counts how many times that phase's run is invoked: 1 = no retry,
 * 2 = retried once via the sanitization pulse.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { reducePhases } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineReducer.js';
import { failAuthDiscovery } from '../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryTelemetry.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
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

describe('PipelineReducer — narrow auth-discovery no-retry', () => {
  it(
    'does NOT retry auth-discovery on the dashboard-not-ready fail code',
    async () => {
      const failure = failAuthDiscovery('AUTH_DISCOVERY_DASHBOARD_NOT_READY', 'reveal missing');
      const run = await driveReducer('auth-discovery', failure);
      expect(run).toHaveBeenCalledTimes(1);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'still retries auth-discovery on a session-invalid fail code',
    async () => {
      const failure = failAuthDiscovery('AUTH_DISCOVERY_SESSION_INVALID', 'cookies absent');
      const run = await driveReducer('auth-discovery', failure);
      expect(run).toHaveBeenCalledTimes(2);
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  it(
    'still retries a non-auth-discovery phase carrying the not-ready code',
    async () => {
      const failure = failAuthDiscovery('AUTH_DISCOVERY_DASHBOARD_NOT_READY', 'reveal missing');
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
