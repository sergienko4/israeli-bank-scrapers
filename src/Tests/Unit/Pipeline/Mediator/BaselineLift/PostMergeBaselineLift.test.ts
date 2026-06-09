/**
 * Coverage backfill — restores `test:pipeline` branches gate to >=95%
 * after merging PR #310 (Mode A/B hard gate) into PR #306. The merge
 * landed several Mediator helpers with happy-path-only coverage that
 * dropped the global pipeline branches threshold from 95.04% to 94.89%.
 *
 * Each test below targets ONE previously-uncovered branch in a
 * different module — pure, deterministic, no Playwright. The PR
 * description tracks a follow-up ticket
 * ("Phase 2 coverage tightening — lift branch buffer above 95.01")
 * to keep raising coverage; this file unblocks atomic landing of
 * the CR PR #306 cycle-2 fix without lowering the threshold.
 */

import { resolveCaptureIndex } from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.Classify.js';
import { failAccountResolutionIncomplete } from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.Failures.js';
import {
  INIT_FORENSICS_ENV_VAR,
  readInitForensicsGate,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/InitForensicsGate.js';
import { recordFailure } from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/State.js';
import type {
  IAuthFailure,
  IWatcherState,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/Types.js';
import { graphemeCount } from '../../../../../Scrapers/Pipeline/Types/PiiRedactor/CommonHelpers.js';

/**
 * Stub response handler — never marks as failure. Kept top-level so
 * the require-jsdoc rule is satisfied for the function expression.
 * @returns Always false.
 */
function stubResponseHandler(): boolean {
  return false;
}

/**
 * Build a fully-typed mutable watcher state for the disposed-skip test.
 * Pulled into a helper so the test body stays under the 10-line cap.
 * @param isDisposed - Initial disposed flag.
 * @returns Mutable IWatcherState.
 */
function makeWatcherState(isDisposed: boolean): IWatcherState {
  return {
    detected: false,
    responseHandler: stubResponseHandler,
    isDisposed,
  };
}

/**
 * Build a minimal IAuthFailure record for the disposed-skip test.
 * @returns Static auth failure record.
 */
function makeAuthFailure(): IAuthFailure {
  return { status: 401, url: 'https://bank.example/auth', bodyPreview: '', classifier: 'http-4xx' };
}

/**
 * Status returned by {@link withTempEnv} confirming the temp value was
 * applied and the prior value restored deterministically.
 */
interface IWithTempEnvStatus {
  readonly applied: true;
}

/**
 * Run `cb` with `process.env[varName] = tempValue`, then restore the
 * prior value (or delete the key if it was previously unset).
 *
 * <p>Extracted per PR-321 cycle-1 CR finding #16 so the calling test
 * body stays ≤10 lines.
 * @param varName - Env-var key to mutate.
 * @param tempValue - Value to set for the duration of the callback.
 * @param cb - Synchronous callback executed while the value is set.
 * @returns Status confirming the temp value was applied + cleanup ran.
 */
function withTempEnv(varName: string, tempValue: string, cb: () => unknown): IWithTempEnvStatus {
  const prior = process.env[varName];
  process.env[varName] = tempValue;
  try {
    cb();
  } finally {
    if (typeof prior === 'string') process.env[varName] = prior;
    else Reflect.deleteProperty(process.env, varName);
  }
  return { applied: true };
}

describe('PostMergeBaselineLift — narrow coverage backfill', () => {
  it('graphemeCount returns 0 for empty input (early-exit branch)', () => {
    const count = graphemeCount('');
    expect(count).toBe(0);
  });

  it('failAccountResolutionIncomplete handles empty containers map (renderContainerCounts none branch)', () => {
    const failure = failAccountResolutionIncomplete({ resolved: 0, expected: 3, containers: {} });
    expect(failure.success).toBe(false);
    const message = failure.success ? '' : failure.errorMessage;
    expect(message).toContain('containers={none}');
  });

  it('readInitForensicsGate returns disabled for env-var value other than 1/true (else branch)', () => {
    withTempEnv(INIT_FORENSICS_ENV_VAR, '0', () => {
      const state = readInitForensicsGate();
      expect(state.enabled).toBe(false);
    });
  });

  it('recordFailure short-circuits when watcher state is disposed (isDisposed true branch)', () => {
    const state = makeWatcherState(true);
    const failure = makeAuthFailure();
    const outcome = recordFailure(state, failure);
    expect(outcome).toBe(false);
    expect(state.detected).toBe(false);
  });

  it('resolveCaptureIndex returns 0 when endpoint is false (no-endpoint branch)', () => {
    const idx = resolveCaptureIndex(false);
    expect(idx).toBe(0);
  });
});
