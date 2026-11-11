/**
 * Warm-failure escalation for TokenStrategyFromConfig. When a warm
 * resume fails, `TokenResolverBuilder` asks the strategy whether to fall back
 * to a cold login. A carry-bundle warm start answers from its `coldFallback`;
 * every other kind answers yes, as before. A token refused locally never gets
 * here: `primeInitial` runs the cold login itself.
 */

import type { IProcedureFailure } from '../../../../Types/Procedure.js';
import { isAuthRejectedFailure } from '../../../Api/ApiMediator.authReject.js';
import type { ColdFallback, IApiDirectCallConfig } from '../../ConfigContracts/index.js';
import { carryBundleWarmOf } from '../WarmStartKind.js';

/** Decides whether one failed warm resume may fall back to a cold login. */
type WarmFailureGate = (failure: IProcedureFailure) => boolean;

/**
 * Let every failure fall back.
 * @returns True.
 */
function allowAnyFailure(): boolean {
  return true;
}

/** The gate each `coldFallback` value selects. */
const COLD_FALLBACK_GATES: Readonly<Record<ColdFallback, WarmFailureGate>> = {
  any: allowAnyFailure,
  'auth-rejected': isAuthRejectedFailure,
};

/**
 * The config's cold fallback; `any` for every kind that declares none.
 * @param config - Bank config.
 * @returns The cold fallback.
 */
function coldFallbackOf(config: IApiDirectCallConfig): ColdFallback {
  const bundle = carryBundleWarmOf(config);
  if (bundle === false) return 'any';
  return bundle.coldFallback;
}

/**
 * Whether a failed warm resume may fall back to a cold login.
 * @param config - Bank config.
 * @param failure - The warm attempt's failure.
 * @returns True when the config's cold fallback lets this failure escalate.
 */
function mayEscalateWarmFailureImpl(
  config: IApiDirectCallConfig,
  failure: IProcedureFailure,
): boolean {
  const fallback = coldFallbackOf(config);
  const gate = COLD_FALLBACK_GATES[fallback];
  return gate(failure);
}

export default mayEscalateWarmFailureImpl;
export { mayEscalateWarmFailureImpl };
