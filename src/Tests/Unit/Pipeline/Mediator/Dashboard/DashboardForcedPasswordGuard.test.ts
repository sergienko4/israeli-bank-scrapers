/**
 * REGRESSION GUARD — R4 forced-password detection MUST stay strict.
 *
 * Locks the origin/main contract: a visible change-password marker is a
 * forced-change interstitial and MUST escalate, regardless of any
 * secondary dashboard-success probe AND regardless of a secondary probe
 * error. PR #381 weakened this (marker treated as benign when a
 * dashboard marker coexists; a probe error coerced to "ready"), silently
 * downgrading a security wall.
 *
 * <p>Fire proof: GREEN on origin/main (strict — one probe, marker ⇒
 * fail). RED against the PR-381 DashboardProbe (the second probe makes
 * checkChangePassword return false, so these expectations fail).
 * Security-relevant: fail-closed.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import checkChangePassword from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardProbe.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';

/** Per-call behaviour for the scripted resolveVisible probe. */
type ProbeBehaviour = 'found' | 'missing' | 'throw';

/** A race result whose marker is present (found). */
const FOUND_RESULT: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const };

/**
 * Build a mediator whose resolveVisible answers a scripted behaviour per
 * call index: call 1 is the change-pwd probe; call 2 is the
 * dashboard-ready probe PR #381 added. Strict detection ignores call 2.
 * @param sequence - Per-call behaviours (index 0 = first call).
 * @returns Mock element mediator.
 */
function makeSequencedMediator(sequence: readonly ProbeBehaviour[]): IElementMediator {
  let call = -1;
  return {
    /**
     * Scripted visibility probe.
     * @returns The scripted result, or a rejection for `throw`.
     */
    resolveVisible: (): Promise<IRaceResult> => {
      call += 1;
      const beh = sequence[call] ?? 'missing';
      if (beh === 'throw') return Promise.reject(new Error('probe-error'));
      return Promise.resolve(beh === 'found' ? FOUND_RESULT : NOT_FOUND_RESULT);
    },
  } as unknown as IElementMediator;
}

/**
 * Assert the probe result is a forced-password-change failure (not a
 * benign `false`). The `not.toBe(false)` is the fire trigger: PR #381
 * returns false here. Named `assert*` so jest/expect-expect recognises
 * it as the test's assertion (eslint.config.mjs §12d).
 * @param result - checkChangePassword return value.
 * @returns The asserted result, for optional chaining by callers.
 */
function assertForcedChange(
  result: Awaited<ReturnType<typeof checkChangePassword>>,
): Awaited<ReturnType<typeof checkChangePassword>> {
  expect(result).not.toBe(false);
  if (result && typeof result === 'object') {
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  }
  return result;
}

describe('REGRESSION GUARD — R4 forced-password stays strict', () => {
  it('escalates when a change-pwd marker COEXISTS with a dashboard-success marker', async () => {
    const mediator = makeSequencedMediator(['found', 'found']);
    const result = await checkChangePassword(mediator);
    assertForcedChange(result);
  });

  it('escalates when a change-pwd marker is found and the secondary probe errors', async () => {
    const mediator = makeSequencedMediator(['found', 'throw']);
    const result = await checkChangePassword(mediator);
    assertForcedChange(result);
  });
});
