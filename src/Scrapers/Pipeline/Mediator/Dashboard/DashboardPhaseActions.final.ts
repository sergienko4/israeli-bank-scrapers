/**
 * DASHBOARD FINAL phase orchestration — gate the txn-traffic match,
 * commit the resolved endpoint, emit the `dashboard.signal.ready`
 * event for SCRAPE.PRE.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"}. Split
 * out so the parent file stays under the LoC cap. Commit helpers
 * live in {@link "./DashboardPhaseActions.final.commit.js"}.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { isBancsTxnCapture } from '../Scrape/Bancs/BancsTxnRequest.js';
import { DASHBOARD_FINAL_TXN_WAIT_MS } from '../Timing/TimingConfig.js';
import { buildApiContext } from './DashboardDiscovery.js';
import { commitTxnEndpoint } from './DashboardPhaseActions.final.commit.js';
import { extractAuthFromContext } from './DashboardProbe.js';

/** WK transactions URL patterns used by FINAL's gatekeeper. */
const FINAL_TXN_PATTERNS = PIPELINE_WELL_KNOWN_API.transactions;

/**
 * Build the API-context override bundle from the pipeline config.
 * @param input - Pipeline context with config.
 * @returns Override bundle for {@link buildApiContext}.
 */
function buildOverrideFromConfig(input: IPipelineContext): {
  readonly baseUrl: string;
  readonly transactionsPath?: string;
} {
  return { baseUrl: input.config.urls.base, transactionsPath: input.config.transactionsPath };
}

/**
 * Build API context from network + fetchStrategy if available.
 * @param input - Pipeline context with mediator + fetchStrategy.
 * @returns Updated context with api populated, or input unchanged.
 */
async function maybeAttachApi(input: IPipelineContext): Promise<IPipelineContext> {
  if (!input.mediator.has) return input;
  if (!input.fetchStrategy.has) return input;
  if (input.api.has) return input;
  const network = input.mediator.value.network;
  await network.cacheAuthToken();
  const override = buildOverrideFromConfig(input);
  const apiCtx = await buildApiContext(network, input.fetchStrategy.value, override);
  return { ...input, api: some(apiCtx) };
}

/**
 * Count hasTxn endpoints from mediator if available.
 * @param ctx - Pipeline context.
 * @returns Endpoint count string.
 */
function countEndpoints(ctx: IPipelineContext): string {
  if (!ctx.mediator.has) return '0';
  return String(ctx.mediator.value.network.getAllEndpoints().length);
}

/** Bundled bucket counts emitted on the `dashboard.signal.ready` event. */
interface INavBucketCounts {
  readonly preNavCount: number;
  readonly postNavCount: number;
}

/**
 * Count the pre-nav / post-nav capture buckets for the FINAL signal.
 * @param ctx - Pipeline context.
 * @returns Bucket counts.
 */
function countNavBuckets(ctx: IPipelineContext): INavBucketCounts {
  if (!ctx.mediator.has) return { preNavCount: 0, postNavCount: 0 };
  const network = ctx.mediator.value.network;
  return {
    preNavCount: network.getPreNavCaptures().length,
    postNavCount: network.getPostNavCaptures().length,
  };
}

/**
 * Verify the post-nav bucket carries at least one WK-transactions URL
 * match.
 * @param ctx - Pipeline context.
 * @returns True iff a WK-transactions match exists in postNav.
 */
function hasPostNavTxnMatch(ctx: IPipelineContext): boolean {
  if (!ctx.mediator.has) return false;
  const postNav = ctx.mediator.value.network.getPostNavCaptures();
  return postNav.some((ep): boolean =>
    FINAL_TXN_PATTERNS.some((p: RegExp): boolean => p.test(ep.url)),
  );
}

/**
 * Whether the FULL captured pool carries a BaNCS CURRENT_ACCOUNT txn
 * capture. BaNCS serves txns from `POST /account` by request body (not
 * URL) and the SPA fires that request during account-resolve (pre-nav),
 * so the post-nav URL gate never sees it. Default-deny via
 * {@link isBancsTxnCapture} — non-BaNCS pools yield `false` and keep the
 * exact post-nav URL-gate semantics.
 * @param ctx - Pipeline context.
 * @returns True iff a BaNCS txn capture exists anywhere in the pool.
 */
function hasBancsTxnCapture(ctx: IPipelineContext): boolean {
  if (!ctx.mediator.has) return false;
  const all = ctx.mediator.value.network.getAllEndpoints();
  return all.some((ep): boolean => isBancsTxnCapture(ep));
}

/**
 * Wait until the post-nav pool exposes at least one WK-txn URL match.
 * @param input - Pipeline context.
 * @returns True when a match landed (or was already present); false on timeout.
 */
async function waitForPostNavTxnMatch(input: IPipelineContext): Promise<boolean> {
  if (!input.mediator.has) return true;
  if (hasPostNavTxnMatch(input)) return true;
  if (hasBancsTxnCapture(input)) return true;
  const hit = await input.mediator.value.network
    .waitForTransactionsTraffic(DASHBOARD_FINAL_TXN_WAIT_MS)
    .catch((): false => false);
  return hit !== false;
}

/** Reason text for the fail-loud FINAL gate. */
const FINAL_GATE_FAIL_REASON =
  'DASHBOARD FINAL: DASHBOARD_TXN_ENDPOINT_MISSING — ' +
  'post-nav pool empty of WK-txn matches after wait budget';

/**
 * Wait gate at the head of FINAL — returns fail-loud when the post-nav
 * pool has no WK-txn match within the budget.
 * @param input - Pipeline context.
 * @returns Fail procedure on miss, or false to continue.
 */
async function gateFinalTxnMatch(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  const isMatched = await waitForPostNavTxnMatch(input);
  if (input.mediator.has && !isMatched) {
    return fail(ScraperErrorTypes.Generic, FINAL_GATE_FAIL_REASON);
  }
  return false;
}

/** Bundle of post-commit FINAL state used to compose the success branch. */
interface IFinalSignalState {
  readonly diag: IPipelineContext['diagnostics'];
  readonly hasAuth: boolean;
  readonly epCount: string;
  readonly preNavCount: number;
  readonly postNavCount: number;
}

/**
 * Build the diagnostics patch for FINAL: `discoveredAuth` + `finalUrl`.
 * @param ctx - Pipeline context after TXN commit.
 * @returns Diagnostics patch + the discoveredAuth string for reuse.
 */
async function buildFinalDiagPatch(ctx: IPipelineContext): Promise<{
  readonly diag: IPipelineContext['diagnostics'];
  readonly discoveredAuth: string | false;
}> {
  const dashUrl = ctx.dashboard.has && ctx.dashboard.value.pageUrl;
  const discoveredAuth = await extractAuthFromContext(ctx);
  const diag = { ...ctx.diagnostics, finalUrl: some(dashUrl || ''), discoveredAuth };
  return { diag, discoveredAuth };
}

/** Bundled inputs for {@link assembleFinalSignalState}. */
interface IAssembleFinalArgs {
  readonly diag: IPipelineContext['diagnostics'];
  readonly hasAuth: boolean;
  readonly counts: INavBucketCounts;
  readonly epCount: string;
}

/**
 * Assemble the {@link IFinalSignalState} bundle from already-computed
 * inputs.
 * @param args - Bundled diagnostics + auth + counts + endpoint count.
 * @returns FINAL signal state bundle.
 */
function assembleFinalSignalState(args: IAssembleFinalArgs): IFinalSignalState {
  return {
    diag: args.diag,
    hasAuth: args.hasAuth,
    epCount: args.epCount,
    preNavCount: args.counts.preNavCount,
    postNavCount: args.counts.postNavCount,
  };
}

/**
 * Build the FINAL post-commit state bundle.
 * @param ctx - Pipeline context after the TXN endpoint commit.
 * @returns Bundle for the signal-ready emit + success procedure.
 */
async function buildFinalSignalState(ctx: IPipelineContext): Promise<IFinalSignalState> {
  const { diag, discoveredAuth } = await buildFinalDiagPatch(ctx);
  const hasAuth = Boolean(discoveredAuth);
  const counts = countNavBuckets(ctx);
  const epCount = countEndpoints(ctx);
  return assembleFinalSignalState({ diag, hasAuth, counts, epCount });
}

/**
 * Emit the canonical `dashboard.signal.ready` event for SCRAPE.PRE.
 * @param input - Pipeline context with logger.
 * @param state - Pre-built FINAL signal state.
 * @returns Always true so the caller stays expression-shaped.
 */
function logSignalReady(input: IPipelineContext, state: IFinalSignalState): true {
  input.logger.debug({
    event: 'dashboard.signal.ready',
    authFound: state.hasAuth,
    endpoints: state.epCount,
    preNavCount: state.preNavCount,
    postNavCount: state.postNavCount,
  });
  return true;
}

/**
 * Emit the signal-ready log line and compose the FINAL success procedure.
 * @param ctx - Pipeline context after TXN commit (carries logger).
 * @param state - Pre-built FINAL signal state.
 * @returns Success procedure carrying the patched diagnostics.
 */
function emitSignalReadyAndSucceed(
  ctx: IPipelineContext,
  state: IFinalSignalState,
): Procedure<IPipelineContext> {
  logSignalReady(ctx, state);
  return succeed({ ...ctx, diagnostics: state.diag });
}

/**
 * Tail of {@link executeCollectAndSignal} after the FINAL gate passed.
 * Attaches API context, commits the TXN endpoint, and emits the
 * signal-ready event.
 * @param input - Pipeline context after the FINAL gate.
 * @returns Updated context with API + signal, or a fail-loud procedure.
 */
async function runFinalCommit(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const withApi = await maybeAttachApi(input);
  const txnCommitted = await commitTxnEndpoint(withApi);
  if (!txnCommitted.ok) return txnCommitted.failure;
  const state = await buildFinalSignalState(txnCommitted.ctx);
  return emitSignalReadyAndSucceed(txnCommitted.ctx, state);
}

/**
 * FINAL: gate the phase, build API context, and emit the
 * `dashboard.signal.ready` event for SCRAPE.PRE.
 * @param input - Pipeline context.
 * @returns Updated context with API + canonical signal, or fail.
 */
async function executeCollectAndSignal(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.dashboard.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD FINAL: not ready');
  const gate = await gateFinalTxnMatch(input);
  if (gate !== false) return gate;
  return runFinalCommit(input);
}

export default executeCollectAndSignal;
export { executeCollectAndSignal };
