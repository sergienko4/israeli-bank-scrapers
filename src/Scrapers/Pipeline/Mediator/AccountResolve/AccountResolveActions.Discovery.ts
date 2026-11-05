/**
 * AccountResolveActions.Discovery — discovery payload assembly.
 * Extracted from the AccountResolveActions barrel so the per-file LoC
 * cap is honoured (phase-2e-residue split).
 */

import { some } from '../../Types/Option.js';
import type { IAccountDiscovery, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { discoverAccountsInPool } from './AccountFromPool.js';
import { resolveCaptureIndex } from './AccountResolveActions.Classify.js';

/** Container/ids/records bundle used by the discovery payload builders. */
interface IDiscoveryResult {
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly containers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

/**
 * Build the {@link IAccountDiscovery} record committed onto
 * `ctx.accountDiscovery`.
 * @param result - Account-resolution outcome from `discoverAccountsInPool`.
 * @param captureIndex - Index of the capture that surfaced the account ids.
 * @returns Discovery record ready to wrap in `some()`.
 */
function buildDiscoveryPayload(result: IDiscoveryResult, captureIndex: number): IAccountDiscovery {
  return {
    ids: result.ids,
    records: result.records,
    containers: result.containers,
    endpointCaptureIndex: captureIndex,
  };
}

/**
 * Build the committed success procedure from a classification's `commit`
 * branch — packages the discovery payload, wraps it in `some`, and
 * clones the pipeline context.
 * @param input - Pipeline context that produced the result.
 * @param result - Resolution outcome from `discoverAccountsInPool`.
 * @returns Success procedure carrying the cloned context.
 */
function buildAccountResolveSuccess(
  input: IPipelineContext,
  result: ReturnType<typeof discoverAccountsInPool>,
): Procedure<IPipelineContext> {
  const captureIndex = resolveCaptureIndex(result.endpoint);
  const discoveryPayload = buildDiscoveryPayload(result, captureIndex);
  const accountDiscovery = some(discoveryPayload);
  return succeed({ ...input, accountDiscovery });
}

export type { IDiscoveryResult };
export { buildAccountResolveSuccess };
