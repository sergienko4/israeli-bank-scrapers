/**
 * TxnParser — DASHBOARD-side TXN harvest builder.
 *
 * <p>Co-located sibling of {@link "./TxnParser.js"} carrying the
 * harvest payload assembler. Pulled out so the parent file stays
 * under the LoC cap. Mirrors how ACCOUNT-RESOLVE builds
 * {@link IAccountDiscovery}: the phase that captured the response
 * normalises the records and commits them as a clean value type so
 * SCRAPE never sees the raw bytes.
 */

import type { ITransaction } from '../../../../Transactions.js';
import type { IDashboardTxnHarvest, ITxnEndpointInternal } from '../../Types/PipelineContext.js';
import detectDateWindowParams, { type IDateWindowProbeInput } from './DateWindowParamsDetector.js';
import detectDedupKeyFields from './DedupKeyFieldsDetector.js';
import { extractAccountIdFromUrl } from './TxnParser.accountId.js';
import { detectMultiAccountScope } from './TxnParser.scope.js';

/**
 * Sentinel key used in `dedupKeyFieldsByAccount` for harvests that
 * captured an unscoped response (no per-account id in URL/body).
 */
const UNSCOPED_ACCOUNT_KEY = '';

/**
 * Resolves the lookup key for a harvest's dedup-key map entry —
 * the captured accountId when set, or `UNSCOPED_ACCOUNT_KEY` for
 * captures with no account in the URL/body.
 * @param capturedAccountId - The account id from the URL/body, or `false` when unscoped.
 * @returns Map key (non-empty accountId or sentinel).
 */
function resolveDedupKeyMapKey(capturedAccountId: string | false): string {
  if (capturedAccountId === false) return UNSCOPED_ACCOUNT_KEY;
  return capturedAccountId;
}

/**
 * Builds the per-account dedup-key map for a harvest. Returns an
 * empty map when SCRAPE cannot reuse the harvest (multi-scope) or
 * when the harvest is empty — both cases skip the detector because
 * its output would be unused.
 * @param records - Normalized records for the harvest.
 * @param capturedAccountId - The account id encoded in the captured URL/body, or `false` when unscoped.
 * @param shouldSkip - When true, the detector is not called (multi-scope harvests or empty record sets).
 * @returns Map keyed by capturedAccountId (or `UNSCOPED_ACCOUNT_KEY` for unscoped harvests).
 */
function buildDedupKeyFieldsMap(
  records: readonly ITransaction[],
  capturedAccountId: string | false,
  shouldSkip: boolean,
): ReadonlyMap<string, readonly string[]> {
  if (shouldSkip) return new Map();
  const fields = detectDedupKeyFields(records);
  const key = resolveDedupKeyMapKey(capturedAccountId);
  return new Map([[key, fields]]);
}

/**
 * Build a single-entry date-window map from already-detected params.
 * Pulled out so {@link buildDateWindowParamsMap} stays under the cap.
 * @param capturedAccountId - Account id from URL/body, or `false` when unscoped.
 * @param params - WK-aliased URL parameter names (`[fromDate, toDate]`).
 * @returns Map with one entry keyed by capturedAccountId or sentinel.
 */
function makeSingleDateWindowMap(
  capturedAccountId: string | false,
  params: readonly string[],
): ReadonlyMap<string, readonly [string, string]> {
  const key = resolveDedupKeyMapKey(capturedAccountId);
  return new Map([[key, [params[0], params[1]]]]);
}

/**
 * Phase H'' — builds the per-account date-window URL-param map from
 * the captured pool. Returns an empty map when SCRAPE cannot reuse
 * the harvest (multi-scope) or when no WK alias pair is observed.
 * @param pool - Captured pool from `INetworkDiscovery.getAllEndpoints`.
 * @param capturedAccountId - The account id encoded in the picked capture's URL/body, or `false` when unscoped.
 * @param shouldSkip - When true, the detector is not called.
 * @returns Map keyed by capturedAccountId; empty map when nothing useful was observed.
 */
function buildDateWindowParamsMap(
  pool: readonly IDateWindowProbeInput[],
  capturedAccountId: string | false,
  shouldSkip: boolean,
): ReadonlyMap<string, readonly [string, string]> {
  if (shouldSkip) return new Map();
  const params = detectDateWindowParams(pool);
  if (params.length < 2) return new Map();
  return makeSingleDateWindowMap(capturedAccountId, params);
}

/** Computed scope decision for a captured TXN endpoint. */
interface IHarvestScope {
  readonly capturedAccountId: string | false;
  readonly isMultiAccountScope: boolean;
  readonly shouldSkipDetector: boolean;
}

/** Inputs for {@link computeScopeFlags}. Bundled to respect the ≤3-param cap. */
interface IComputeScopeFlagsArgs {
  readonly internal: ITxnEndpointInternal;
  readonly accountIdCount: number;
  readonly capturedAccountId: string | false;
}

/** Derived multi-account / skip flags computed from raw inputs. */
interface IScopeFlags {
  readonly isMultiAccountScope: boolean;
  readonly shouldSkipDetector: boolean;
}

/**
 * Combine the raw inputs into the derived multi-account / skip flags
 * the harvest builder consumes. Pulled out so {@link resolveHarvestScope}
 * stays under the LoC cap.
 * @param args - Bundled resolver result + accountId-count + capturedAccountId.
 * @returns Derived scope flags.
 */
function computeScopeFlags(args: IComputeScopeFlagsArgs): IScopeFlags {
  const isBodyShapeMulti = detectMultiAccountScope(args.internal.responseBodySample);
  const isContextMulti = args.capturedAccountId === false && args.accountIdCount > 1;
  const isMultiAccountScope = isBodyShapeMulti || isContextMulti;
  const shouldSkipDetector = isMultiAccountScope || args.internal.normalizedRecords.length === 0;
  return { isMultiAccountScope, shouldSkipDetector };
}

/**
 * Resolve the captured-scope flags for a TXN endpoint. The decision
 * is purely a function of the captured URL, the raw body shape, and
 * how many accounts ACCOUNT-RESOLVE committed.
 * @param internal - DASHBOARD-internal resolver result.
 * @param accountIdCount - Accounts ACCOUNT-RESOLVE committed.
 * @returns Scope flags consumed by the harvest builder.
 */
function resolveHarvestScope(
  internal: ITxnEndpointInternal,
  accountIdCount: number,
): IHarvestScope {
  const capturedAccountId = extractAccountIdFromUrl(internal.endpoint.url);
  const flags = computeScopeFlags({ internal, accountIdCount, capturedAccountId });
  return { capturedAccountId, ...flags };
}

/** Per-account harvest maps the assembler folds into the payload. */
interface IHarvestMaps {
  readonly dedupKeyFieldsByAccount: ReadonlyMap<string, readonly string[]>;
  readonly dateWindowParamsByAccount: ReadonlyMap<string, readonly [string, string]>;
}

/** Inputs for {@link buildHarvestMaps}. Bundled to respect the ≤3-param cap. */
interface IBuildHarvestMapsArgs {
  readonly records: readonly ITransaction[];
  readonly scope: IHarvestScope;
  readonly pool: readonly IDateWindowProbeInput[];
}

/**
 * Project {@link IBuildHarvestMapsArgs} onto {@link buildDedupKeyFieldsMap}.
 * @param args - Bundled records, scope flags, and captured pool.
 * @returns Per-account dedup-key field-name tuples.
 */
function buildDedupMapFromArgs(
  args: IBuildHarvestMapsArgs,
): ReadonlyMap<string, readonly string[]> {
  const { records, scope } = args;
  return buildDedupKeyFieldsMap(records, scope.capturedAccountId, scope.shouldSkipDetector);
}

/**
 * Project {@link IBuildHarvestMapsArgs} onto {@link buildDateWindowParamsMap}.
 * @param args - Bundled records, scope flags, and captured pool.
 * @returns Per-account WK-aliased `[fromDate, toDate]` URL parameter tuples.
 */
function buildDateWindowMapFromArgs(
  args: IBuildHarvestMapsArgs,
): ReadonlyMap<string, readonly [string, string]> {
  const { pool, scope } = args;
  return buildDateWindowParamsMap(pool, scope.capturedAccountId, scope.isMultiAccountScope);
}

/**
 * Build the per-account dedup-key and date-window maps for a harvest.
 * @param args - Bundled records, scope flags, and captured pool.
 * @returns Per-account dedup-key and date-window maps.
 */
function buildHarvestMaps(args: IBuildHarvestMapsArgs): IHarvestMaps {
  const dedupKeyFieldsByAccount = buildDedupMapFromArgs(args);
  const dateWindowParamsByAccount = buildDateWindowMapFromArgs(args);
  return { dedupKeyFieldsByAccount, dateWindowParamsByAccount };
}

/** Bundle for {@link assembleHarvestPayload} — keeps the signature single-line. */
interface IAssembleHarvestArgs {
  readonly records: readonly ITransaction[];
  readonly scope: IHarvestScope;
  readonly maps: IHarvestMaps;
}

/**
 * Assemble the final {@link IDashboardTxnHarvest} payload from the
 * resolved scope, records, and per-account maps. Pure projection
 * helper — kept module-scope so {@link buildTxnHarvest} body remains
 * a small orchestration sequence.
 * @param args - Bundled records + scope + maps.
 * @returns Harvest payload for `ctx.dashboardTxnHarvest`.
 */
function assembleHarvestPayload(args: IAssembleHarvestArgs): IDashboardTxnHarvest {
  return {
    records: args.records,
    capturedAccountId: args.scope.capturedAccountId,
    multiAccountScope: args.scope.isMultiAccountScope,
    dedupKeyFieldsByAccount: args.maps.dedupKeyFieldsByAccount,
    dateWindowParamsByAccount: args.maps.dateWindowParamsByAccount,
  };
}

/**
 * Builds the DASHBOARD-side TXN harvest from the internal resolver
 * payload. Mirrors how ACCOUNT-RESOLVE builds {@link IAccountDiscovery}
 * — the phase that captured the response normalizes the records and
 * commits them as a clean value type. SCRAPE consumes the resulting
 * `readonly ITransaction[]` without seeing captured raw bytes.
 * @param internal - DASHBOARD-internal resolver result.
 * @param accountIdCount - Accounts ACCOUNT-RESOLVE committed.
 * @param pool - Captured network pool — handed to the Phase H'' date-window detector.
 * @returns Harvest payload for `ctx.dashboardTxnHarvest`.
 */
function buildTxnHarvest(
  internal: ITxnEndpointInternal,
  accountIdCount: number,
  pool: readonly IDateWindowProbeInput[] = [],
): IDashboardTxnHarvest {
  const scope = resolveHarvestScope(internal, accountIdCount);
  const records = internal.normalizedRecords;
  const maps = buildHarvestMaps({ records, scope, pool });
  return assembleHarvestPayload({ records, scope, maps });
}

export default buildTxnHarvest;
export { buildTxnHarvest };
