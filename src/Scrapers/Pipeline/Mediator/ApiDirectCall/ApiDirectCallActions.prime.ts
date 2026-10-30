/**
 * ACTION-stage prime helpers for the ApiDirectCall phase: hand the bank's
 * auth-mode policy to the bus, then run primeSession behind the
 * empty-header guard the policy calls for.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk } from '../../Types/Procedure.js';
import type { IApiMediator } from '../Api/ApiMediator.js';
import { PHASE_LABEL, safeInvoke } from './ApiDirectCallActions.shared.js';
import type { IApiDirectCallConfig } from './ConfigContracts/index.js';
import { authPolicyOf, type IAuthModePolicy } from './Flow/AuthModePolicy.js';

/**
 * Standard empty-header failure builder.
 * @returns Procedure failure for empty primeSession result.
 */
function emptyHeaderFail<T>(): Procedure<T> {
  return fail(ScraperErrorTypes.Generic, `${PHASE_LABEL} ACTION empty header`);
}

/**
 * Run primeSession with safeInvoke + empty-header guard. A scheme that sends
 * no header (`'none'`) expects the empty value, so the guard is skipped.
 * @param bus - ApiMediator.
 * @param policy - The bank's auth-mode policy.
 * @returns Header string procedure.
 */
async function primeAndCheck(
  bus: IApiMediator,
  policy: IAuthModePolicy,
): Promise<Procedure<string>> {
  const primed = await safeInvoke('ACTION primeSession', () => bus.primeSession());
  if (!isOk(primed)) return primed;
  if (!policy.installHeader) return primed;
  if (primed.value.length === 0) return emptyHeaderFail();
  return primed;
}

/**
 * Hand the bank's auth-mode policy to the bus before any login call, so the
 * login steps obey it too (a cookie session never re-runs its login).
 * @param bus - ApiMediator.
 * @param config - API-direct-call config.
 * @returns The policy that was applied.
 */
function applyAuthPolicy(bus: IApiMediator, config: IApiDirectCallConfig): IAuthModePolicy {
  const policy = authPolicyOf(config);
  bus.setAuthPolicy?.(policy);
  return policy;
}

export { applyAuthPolicy, primeAndCheck };
