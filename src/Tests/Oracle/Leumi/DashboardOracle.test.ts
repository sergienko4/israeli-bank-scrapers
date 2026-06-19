import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import checkChangePassword from '../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardProbe.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';

/** Per-call behaviour for the representative dashboard marker probe. */
type ProbeBehaviour = 'found' | 'missing' | 'throw';

/** A race result whose marker is present. */
const FOUND_RESULT: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const };

/**
 * Resolves one scripted probe behaviour.
 * @param behaviour - Probe behaviour.
 * @returns Probe result promise.
 */
function resolveProbeBehaviour(behaviour: ProbeBehaviour): Promise<IRaceResult> {
  if (behaviour === 'throw') return Promise.reject(new Error('oracle-probe-error'));
  return Promise.resolve(behaviour === 'found' ? FOUND_RESULT : NOT_FOUND_RESULT);
}

/**
 * Builds a scripted visibility probe.
 * @param sequence - Per-call probe behaviours.
 * @returns Visibility probe callback.
 */
function makeResolveVisible(sequence: readonly ProbeBehaviour[]): () => Promise<IRaceResult> {
  let call = -1;
  return (): Promise<IRaceResult> => {
    call += 1;
    return resolveProbeBehaviour(sequence[call] ?? 'missing');
  };
}

/**
 * Builds a mediator whose visibility probe follows a fixed sequence.
 * @param sequence - Per-call probe behaviours.
 * @returns Mock element mediator.
 */
function makeSequencedMediator(sequence: readonly ProbeBehaviour[]): IElementMediator {
  return { resolveVisible: makeResolveVisible(sequence) } as unknown as IElementMediator;
}

/**
 * Asserts a typed Procedure failure.
 * @param result - Dashboard probe result.
 * @param errorType - Expected error type.
 * @returns True after assertions.
 */
function assertProbeFailure(
  result: Awaited<ReturnType<typeof checkChangePassword>>,
  errorType: ScraperErrorTypes,
): true {
  expect(result).not.toBe(false);
  if (result && typeof result === 'object') expect(result.success).toBe(false);
  if (result && typeof result === 'object' && !result.success)
    expect(result.errorType).toBe(errorType);
  return true;
}

describe('Leumi oracle — dashboard fail-closed readiness', () => {
  it('returns a forced-password failure for a change-password marker capture', async () => {
    const mediator = makeSequencedMediator(['found']);
    const result = await checkChangePassword(mediator);
    assertProbeFailure(result, ScraperErrorTypes.ChangePassword);
  });

  it('returns a typed failure when the dashboard probe errors', async () => {
    const mediator = makeSequencedMediator(['throw']);
    const result = await checkChangePassword(mediator);
    assertProbeFailure(result, ScraperErrorTypes.Generic);
  });
});
