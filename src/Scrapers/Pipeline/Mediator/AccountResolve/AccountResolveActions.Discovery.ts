/**
 * AccountResolveActions.Discovery — discovery payload assembly.
 * Extracted from the AccountResolveActions barrel so the per-file LoC
 * cap is honoured (phase-2e-residue split).
 */

import { isSome, some } from '../../Types/Option.js';
import type {
  IAccountDiscovery,
  IBillingCycleCatalog,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import type { discoverAccountsInPool } from './AccountFromPool.js';
import { resolveCaptureIndex } from './AccountResolveActions.Classify.js';
import { detectBillingCycleCatalog } from './BillingCycleCatalogDetector.js';

/** Container/ids/records bundle used by the discovery payload builders. */
interface IDiscoveryResult {
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly containers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

/** Bundled args for the discovery payload assembler. */
interface IDiscoveryPayloadArgs {
  readonly pool: readonly IDiscoveredEndpoint[];
  readonly result: IDiscoveryResult;
  readonly captureIndex: number;
}

/**
 * Build the core {@link IAccountDiscovery} record (no optional fields).
 * @param result - Account-resolution outcome from `discoverAccountsInPool`.
 * @param captureIndex - Index of the capture that surfaced the account ids.
 * @returns Base discovery record sans optional catalog.
 */
function buildBaseDiscovery(result: IDiscoveryResult, captureIndex: number): IAccountDiscovery {
  return {
    ids: result.ids,
    records: result.records,
    containers: result.containers,
    endpointCaptureIndex: captureIndex,
  };
}

/**
 * Assemble the {@link IAccountDiscovery} payload committed onto
 * `ctx.accountDiscovery`. Adds the optional billing-cycle catalog
 * when the detector recognises a known shape in the pre-nav pool.
 * @param args - Bundled pool + result + captureIndex.
 * @returns Fully-populated discovery record ready to wrap in `some()`.
 */
function buildDiscoveryPayload(args: IDiscoveryPayloadArgs): IAccountDiscovery {
  const base = buildBaseDiscovery(args.result, args.captureIndex);
  const catalogOption = detectBillingCycleCatalog(args.pool);
  if (!isSome(catalogOption)) return base;
  const billingCycleCatalog: IBillingCycleCatalog = catalogOption.value;
  return { ...base, billingCycleCatalog };
}

/**
 * Build the committed success procedure from a classification's `commit`
 * branch — packages the discovery payload, wraps it in `some`, and
 * clones the pipeline context.
 * @param input - Pipeline context that produced the result.
 * @param pool - Pre-nav capture pool (drives catalog detection).
 * @param result - Resolution outcome from `discoverAccountsInPool`.
 * @returns Success procedure carrying the cloned context.
 */
function buildAccountResolveSuccess(
  input: IPipelineContext,
  pool: readonly IDiscoveredEndpoint[],
  result: ReturnType<typeof discoverAccountsInPool>,
): Procedure<IPipelineContext> {
  const captureIndex = resolveCaptureIndex(result.endpoint);
  const discoveryPayload = buildDiscoveryPayload({ pool, result, captureIndex });
  const accountDiscovery = some(discoveryPayload);
  return succeed({ ...input, accountDiscovery });
}

export type { IDiscoveryResult };
export { buildAccountResolveSuccess };
