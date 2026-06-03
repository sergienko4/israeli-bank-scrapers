/**
 * TXN endpoint commit helpers for DASHBOARD FINAL.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"}. Split
 * out so the parent file stays under the LoC cap. Carries the
 * dormant-empty / fail-loud / success commit branches and their
 * supporting payload builders.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ITxnEndpointInternal } from '../../Types/Domain/TxnEndpointTypes.js';
import type { IDashboardTxnHarvest } from '../../Types/Domain/TxnHarvestTypes.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { EMPTY_TXN_HARVEST } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import type { INetworkDiscovery } from '../Network/NetworkDiscoveryTypes.js';
import { resolveTxnEndpoint } from '../Scrape/ScrapeAutoMapper.js';
import { EMPTY_TXN_ENDPOINT } from '../Scrape/ScrapePhaseActions.js';
import detectDormantEvidence from './DormantEvidenceDetector.js';
import { buildTxnHarvest } from './TxnParser.js';

/** Outcome of {@link commitTxnEndpoint} — discriminated success/fail. */
interface ITxnCommitOutcome {
  readonly ok: boolean;
  readonly ctx: IPipelineContext;
  readonly failure: Procedure<IPipelineContext>;
}

/** Sentinel empty-failure procedure used by success branches of commit helpers. */
const EMPTY_COMMIT_FAILURE = fail(ScraperErrorTypes.Generic, '');

/**
 * Read the count of accounts ACCOUNT-RESOLVE.POST committed onto
 * `ctx.accountDiscovery.ids`.
 * @param ctx - Pipeline context.
 * @returns Number of resolved account ids, or 0 when absent.
 */
function readAccountIdCount(ctx: IPipelineContext): number {
  if (!ctx.accountDiscovery.has) return 0;
  return ctx.accountDiscovery.value.ids.length;
}

/** Reason text for the dormant-empty commit log line. */
const DORMANT_COMMIT_REASON =
  'resolveTxnEndpoint returned false; captured pool carries empty-window evidence — ' +
  'committing empty endpoint per spec.txt:162';

/**
 * Build the dormant-empty context patch — applies the empty endpoint +
 * harvest.
 * @param ctx - Pipeline context to patch.
 * @returns Pipeline context with dormant-empty commits applied.
 */
function buildDormantEmptyCtx(ctx: IPipelineContext): IPipelineContext {
  const txnEndpoint = some(EMPTY_TXN_ENDPOINT);
  const dashboardTxnHarvest = some(EMPTY_TXN_HARVEST);
  return { ...ctx, txnEndpoint, dashboardTxnHarvest };
}

/**
 * Phase H'' (2026-05-15): commit an empty endpoint shape when the
 * captured pool carries dormant-account evidence.
 * @param ctx - Pipeline context.
 * @returns Outcome carrying the empty-endpoint commit.
 */
function commitDormantEmptyEndpoint(ctx: IPipelineContext): ITxnCommitOutcome {
  ctx.logger.debug({ event: 'dashboard.txnEndpoint.dormantEmpty', reason: DORMANT_COMMIT_REASON });
  const newCtx = buildDormantEmptyCtx(ctx);
  return { ok: true, ctx: newCtx, failure: EMPTY_COMMIT_FAILURE };
}

/** Reason text for the fail-loud debug log line. */
const FIELDMAP_FAIL_LOUD_REASON =
  'resolveTxnEndpoint returned false; TXN body missing date or amount field aliases';

/**
 * Build the FIELDMAP_INCOMPLETE fail-loud procedure.
 * @returns Fail procedure carrying the canonical error message.
 */
function buildFieldMapFailLoud(): Procedure<IPipelineContext> {
  return fail(
    ScraperErrorTypes.Generic,
    `DASHBOARD FINAL: DASHBOARD_TXN_FIELDMAP_INCOMPLETE — ${FIELDMAP_FAIL_LOUD_REASON}`,
  );
}

/**
 * Fail loud — picker returned no WK-txn URL AND no dormant evidence
 * exists in the captured pool.
 * @param ctx - Pipeline context.
 * @returns Outcome carrying the fail-loud procedure.
 */
function commitTxnEndpointFailLoud(ctx: IPipelineContext): ITxnCommitOutcome {
  ctx.logger.debug({
    event: 'dashboard.txnEndpoint.failLoud',
    code: 'DASHBOARD_TXN_FIELDMAP_INCOMPLETE',
    reason: FIELDMAP_FAIL_LOUD_REASON,
  });
  return { ok: false, ctx, failure: buildFieldMapFailLoud() };
}

/**
 * Branch on the captured pool when the picker returned false.
 * @param ctx - Pipeline context with a live mediator.
 * @param network - Live network discovery handle (caller-narrowed).
 * @returns Outcome — commit-empty (ok) or fail-loud (not ok).
 */
function handleNoTxnEndpoint(ctx: IPipelineContext, network: INetworkDiscovery): ITxnCommitOutcome {
  const pool = network.getAllEndpoints();
  if (detectDormantEvidence(pool)) return commitDormantEmptyEndpoint(ctx);
  return commitTxnEndpointFailLoud(ctx);
}

/**
 * Sentinel "no-op" success outcome used when the commit is bypassed
 * (mediator-less or mock-mode).
 * @param ctx - Pipeline context to pass through unchanged.
 * @returns Success outcome that leaves the context untouched.
 */
function buildBypassOutcome(ctx: IPipelineContext): ITxnCommitOutcome {
  return { ok: true, ctx, failure: EMPTY_COMMIT_FAILURE };
}

/** Static `event` tag for the committed-endpoint telemetry payload. */
const TXN_COMMITTED_EVENT = 'dashboard.txnEndpoint.committed';

/**
 * Build the endpoint-derived half of {@link buildTxnCommittedPayload}.
 * @param internal - Resolver result that was just committed.
 * @returns Endpoint fingerprint fragment.
 */
function buildTxnEndpointFingerprint(internal: ITxnEndpointInternal): Record<string, unknown> {
  return {
    method: internal.endpoint.method,
    fieldMapDate: internal.endpoint.fieldMap.date,
    fieldMapAmount: internal.endpoint.fieldMap.amount,
    pendingUrlPresent: internal.endpoint.pendingUrl !== false,
    billingUrlPresent: internal.endpoint.billingUrl !== false,
  };
}

/**
 * Build the resolver-context half of {@link buildTxnCommittedPayload}
 * — captureIndex / pickerTier / record counts.
 * @param internal - Resolver result that was just committed.
 * @returns Resolver-context fragment.
 */
function buildTxnResolverContext(internal: ITxnEndpointInternal): Record<string, unknown> {
  return {
    captureIndex: internal.captureIndex,
    normalizedRecords: internal.normalizedRecords.length,
    pickerTier: internal.pickerTier,
    capturedPreClick: internal.capturedPreClick,
  };
}

/**
 * Build the structured payload for the `dashboard.txnEndpoint.committed`
 * event by merging the endpoint fingerprint with the resolver context.
 * @param internal - Resolver result that was just committed.
 * @returns Telemetry payload literal.
 */
function buildTxnCommittedPayload(internal: ITxnEndpointInternal): Record<string, unknown> {
  return {
    event: TXN_COMMITTED_EVENT,
    ...buildTxnEndpointFingerprint(internal),
    ...buildTxnResolverContext(internal),
  };
}

/**
 * Emit the `dashboard.txnEndpoint.committed` debug event.
 * @param ctx - Pipeline context (for logger access).
 * @param internal - Resolver result that was just committed.
 * @returns Always true so the caller stays expression-shaped.
 */
function logTxnEndpointCommitted(ctx: IPipelineContext, internal: ITxnEndpointInternal): true {
  const payload = buildTxnCommittedPayload(internal);
  ctx.logger.debug(payload);
  return true;
}

/**
 * Emit the `dashboard.txnHarvest.committed` debug event.
 * @param ctx - Pipeline context (for logger access).
 * @param harvest - Harvest payload that was just committed.
 * @returns Always true so the caller stays expression-shaped.
 */
function logTxnHarvestCommitted(ctx: IPipelineContext, harvest: IDashboardTxnHarvest): true {
  ctx.logger.debug({
    event: 'dashboard.txnHarvest.committed',
    records: harvest.records.length,
    capturedAccountIdPresent: harvest.capturedAccountId !== false,
    multiAccountScope: harvest.multiAccountScope,
  });
  return true;
}

/**
 * Patch the pipeline context with the just-resolved TXN endpoint +
 * harvest.
 * @param ctx - Pipeline context.
 * @param internal - Resolver result carrying the endpoint to commit.
 * @param harvest - Harvest payload to commit.
 * @returns Pipeline context with both options populated.
 */
function applyEndpointCommit(
  ctx: IPipelineContext,
  internal: ITxnEndpointInternal,
  harvest: IDashboardTxnHarvest,
): IPipelineContext {
  return { ...ctx, txnEndpoint: some(internal.endpoint), dashboardTxnHarvest: some(harvest) };
}

/**
 * Build the harvest payload for {@link commitResolvedEndpoint}.
 * @param ctx - Pipeline context with a live mediator.
 * @param internal - Resolver result carrying the endpoint to commit.
 * @returns Harvest payload (records + multi-account scope).
 */
function buildResolvedHarvest(
  ctx: IPipelineContext,
  internal: ITxnEndpointInternal,
): IDashboardTxnHarvest {
  const accountIdCount = readAccountIdCount(ctx);
  const network = ctx.mediator.has ? ctx.mediator.value.network : undefined;
  const pool = network ? network.getAllEndpoints() : [];
  return buildTxnHarvest(internal, accountIdCount, pool);
}

/**
 * Commit a successfully-resolved TXN endpoint + its pre-extracted harvest
 * to the pipeline context, emitting both debug events for telemetry.
 * @param ctx - Pipeline context with a live mediator.
 * @param internal - Resolver result carrying endpoint + records.
 * @returns Success outcome with the patched context.
 */
function commitResolvedEndpoint(
  ctx: IPipelineContext,
  internal: ITxnEndpointInternal,
): ITxnCommitOutcome {
  const harvest = buildResolvedHarvest(ctx, internal);
  const updated = applyEndpointCommit(ctx, internal, harvest);
  logTxnEndpointCommitted(ctx, internal);
  logTxnHarvestCommitted(ctx, harvest);
  return { ok: true, ctx: updated, failure: EMPTY_COMMIT_FAILURE };
}

/**
 * Phase 7e — commit the resolved TXN endpoint to `ctx.txnEndpoint`,
 * or fail loud with `DASHBOARD_TXN_FIELDMAP_INCOMPLETE`.
 * @param ctx - Pipeline context after `maybeAttachApi`.
 * @returns Outcome carrying the updated context or fail-loud procedure.
 */
async function commitTxnEndpoint(ctx: IPipelineContext): Promise<ITxnCommitOutcome> {
  await Promise.resolve();
  if (!ctx.mediator.has) return buildBypassOutcome(ctx);
  const network = ctx.mediator.value.network;
  const internal = resolveTxnEndpoint(network);
  if (internal === false) return handleNoTxnEndpoint(ctx, network);
  return commitResolvedEndpoint(ctx, internal);
}

export type { ITxnCommitOutcome };
export { commitTxnEndpoint };
export default commitTxnEndpoint;
