/**
 * T-PULSE — HOME's second recovery pulse.
 *
 * <p>Clearing an obstruction and making progress past it are separate steps.
 * Max stacks a consent bar and a marketing modal: the modal swallows HOME's
 * trigger click, so the first pulse clears the modal and only the second sees
 * the menu that click finally opened. With a single pulse HOME stops one move
 * short of the login link.
 *
 * <p>The budget is deliberately narrow. It first shipped pipeline-wide and
 * silently broke two reducer suites that pin a single retry, so T-PULSE-2
 * guards the blast radius as much as T-PULSE-1 guards the fix.
 *
 * <p>Each case drives reducePhases over one perpetually-failing phase and
 * counts its run invocations: 2 = one pulse, 3 = two pulses.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { reducePhases } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineReducer.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from './MockFactories.js';

/** Generous per-test budget: each reducePhases incurs one ~4s PRE settle. */
const PULSE_TEST_TIMEOUT_MS = 30_000;

/**
 * Drive reducePhases over a single always-failing phase.
 * @param name - Phase name exposed as step.name.
 * @returns The run spy, so its invocation count is assertable.
 */
async function countRuns(name: PhaseName): Promise<jest.Mock> {
  const failure = fail(ScraperErrorTypes.Generic, 'obstruction still present');
  const run = jest.fn((): Promise<Procedure<IPipelineContext>> => Promise.resolve(failure));
  const ctx = makeMockContext();
  const tracker = {
    phases: [{ name, run } as unknown as BasePhase],
    interceptors: [],
    lastCtx: ctx,
  };
  await reducePhases(tracker, ctx, 0);
  return run;
}

describe('PipelineReducer — HOME pulse budget (T-PULSE)', () => {
  it(
    'T-PULSE-1 (FIRING): HOME gets two pulses',
    async () => {
      const run = await countRuns('home');
      expect(run).toHaveBeenCalledTimes(3);
    },
    PULSE_TEST_TIMEOUT_MS,
  );

  it(
    'T-PULSE-2: every other phase keeps its single pulse',
    async () => {
      const run = await countRuns('dashboard');
      expect(run).toHaveBeenCalledTimes(2);
    },
    PULSE_TEST_TIMEOUT_MS,
  );
});
