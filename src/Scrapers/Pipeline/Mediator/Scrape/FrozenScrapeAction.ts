/**
 * Frozen DIRECT scrape — sealed execution with frozen network.
 * Rebuilds API context with frozen headers (SPA-specific included).
 * Extracted from ScrapePhaseActions to respect max-dependencies.
 *
 * <p>Phase 7f: SCRAPE consumes the slim {@link ITxnEndpoint}
 * DASHBOARD.FINAL committed to `ctx.txnEndpoint`. The deleted
 * `TxnEndpointBridge` adapter is replaced by a direct read; the
 * frozen replay path either consumes the live ctx commit (production
 * SCRAPE) or the discovery snapshot taken at SCRAPE.PRE freeze time
 * (mock-mode bypass / replay tests). Pending and billing URLs travel
 * nested inside the slim endpoint.
 */

import moment from 'moment';

import type { ITransactionsAccount } from '../../../../Transactions.js';
import { fetchAndMergePending } from '../../Strategy/Scrape/Account/PendingStrategy.js';
import { scrapeAllAccounts } from '../../Strategy/Scrape/Account/ScrapeDispatch.js';
import {
  applyGlobalDateFilter,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
} from '../../Strategy/Scrape/ScrapeDataActions.js';
import type { IAccountFetchCtx, IFetchAllAccountsCtx } from '../../Strategy/Scrape/ScrapeTypes.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import {
  type IActionContext,
  type IApiFetchContext,
  type IScrapeDiscovery,
  type ITxnEndpoint,
} from '../../Types/PipelineContext.js';
import { type Procedure, succeed } from '../../Types/Procedure.js';
import { getFutureMonths } from '../../Types/ScraperDefaults.js';
import { createFrozenNetwork } from '../Network/NetworkDiscovery.js';
import {
  readDashboardTxnHarvest,
  readDateWindowParams,
  readDedupKeyFields,
  readPreDiscoveredTxn,
} from './ScrapePhaseActions.js';

const LOG = createLogger('frozen-scrape');

/**
 * Execute frozen DIRECT scrape — full flow with guards.
 * @param input - Sealed action context.
 * @returns Updated context with scrape.accounts populated.
 */
async function executeFrozenDirectScrape(
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  const guard = guardFrozenScrape(input);
  if (guard !== false) return guard;
  if (!input.scrapeDiscovery.has) return succeed(input);
  return runFrozenScrape(input, input.scrapeDiscovery.value);
}

/**
 * Bundled inputs for {@link buildFrozenFetchCtx} — keeps arity at 1.
 */
interface IFetchCtxInputs {
  readonly input: IActionContext;
  readonly disc: IScrapeDiscovery;
  readonly api: IApiFetchContext;
}

/**
 * Same as {@link IAccountFetchCtx} but with a narrowed, non-optional
 * `txnEndpoint`. Frozen scrape always resolves this at PRE time via
 * {@link pickFrozenTxnEndpoint}, so downstream helpers can read it
 * directly without re-asserting presence.
 */
type IFrozenFetchCtx = IAccountFetchCtx & { readonly txnEndpoint: ITxnEndpoint };

/**
 * Bundled inputs for {@link mergePendingFor} — keeps arity at 1.
 */
interface IMergePendingArgs {
  readonly fc: IFrozenFetchCtx;
  readonly loadCtx: IFetchAllAccountsCtx;
  readonly raw: readonly ITransactionsAccount[];
}

/**
 * Bundled inputs for {@link scrapeWithFrozen} — keeps arity at 1.
 */
interface IScrapeFrozenArgs {
  readonly disc: IScrapeDiscovery;
  readonly fc: IFrozenFetchCtx;
}

/**
 * DASHBOARD-derived slices shared into {@link IAccountFetchCtx} so
 * tryFirstWave can attribute records DASHBOARD already saw without
 * re-fetching (Hapoalim/Beinleumi 302 regression recovery).
 */
type IDashboardDerived = Pick<
  IAccountFetchCtx,
  'dashboardTxnHarvest' | 'dedupKeyFields' | 'dateWindowParams'
>;

/**
 * Log `[ACTION] <msg>` at DEBUG then short-circuit with `succeed(input)`.
 * @param input - Sealed action context.
 * @param msg - Reason for skipping.
 * @returns Procedure that propagates input unchanged.
 */
function debugAndSucceed(input: IActionContext, msg: string): Procedure<IActionContext> {
  LOG.debug({ message: `[ACTION] ${msg}` });
  return succeed(input);
}

/**
 * Guard: check preconditions for frozen scrape.
 * @param input - Sealed action context.
 * @returns Succeed(input) if should skip, false if ready.
 */
function guardFrozenScrape(input: IActionContext): Procedure<IActionContext> | false {
  if (!input.scrapeDiscovery.has) return debugAndSucceed(input, 'no scrapeDiscovery — skipping');
  if (!input.api.has) return succeed(input);
  const eps = input.scrapeDiscovery.value.frozenEndpoints ?? [];
  return eps.length === 0 ? debugAndSucceed(input, 'no frozen endpoints — skipping') : false;
}

/**
 * Build the frozen-network adapter for sealed replay.
 * @param disc - Narrowed scrape discovery.
 * @returns Frozen INetworkDiscovery wrapping the seal-time endpoints.
 */
function buildFrozenAdapter(disc: IScrapeDiscovery): ReturnType<typeof createFrozenNetwork> {
  const eps = disc.frozenEndpoints ?? [];
  const cachedAuth = disc.cachedAuth ?? false;
  const dashboardClickAt = disc.dashboardClickAt ?? false;
  return createFrozenNetwork(eps, cachedAuth, dashboardClickAt);
}

/**
 * Resolve the DASHBOARD-derived harvest + dedup + window slices.
 * @param input - Sealed action context.
 * @returns Bundle assignable into {@link IAccountFetchCtx}.
 */
function resolveDashboardDerived(input: IActionContext): IDashboardDerived {
  const dashboardTxnHarvest = readDashboardTxnHarvest(input);
  const dedupKeyFields = readDedupKeyFields(dashboardTxnHarvest, FALLBACK_DEDUP_KEY_FIELDS);
  const dateWindowParams = readDateWindowParams(dashboardTxnHarvest);
  return { dashboardTxnHarvest, dedupKeyFields, dateWindowParams };
}

/**
 * Assemble the IAccountFetchCtx for a frozen scrape. Phase 7f: the
 * slim TXN endpoint is preferred from ctx (DASHBOARD.FINAL) with a
 * fall-back to the SCRAPE.PRE discovery snapshot for mock/replay.
 * @param args - Bundled inputs (input, disc, api).
 * @returns IAccountFetchCtx ready for scrapeAllAccounts.
 */
function buildFrozenFetchCtx(args: IFetchCtxInputs): IFrozenFetchCtx {
  const network = buildFrozenAdapter(args.disc);
  const startDate = moment(args.input.options.startDate).format('YYYYMMDD');
  const futureMonths = getFutureMonths(args.input.options);
  const ctxTxn = readPreDiscoveredTxn(args.input);
  const txnEndpoint = pickFrozenTxnEndpoint(ctxTxn, args.disc.txnEndpoint ?? false);
  const derived = resolveDashboardDerived(args.input);
  return { api: args.api, network, startDate, futureMonths, txnEndpoint, ...derived };
}

/**
 * Wrap fetchAndMergePending in a 1-arg adapter to keep the orchestrator
 * call site short and bypass the nested-call lint rule.
 * @param args - Bundled inputs (fc, loadCtx, raw).
 * @returns Accounts merged with their pending txns.
 */
async function mergePendingFor(args: IMergePendingArgs): Promise<readonly ITransactionsAccount[]> {
  return fetchAndMergePending({
    api: args.fc.api,
    accounts: args.raw,
    accountRecords: args.loadCtx.records,
    pendingUrl: args.fc.txnEndpoint.pendingUrl,
  });
}

/**
 * Execute the scrape pipeline against a frozen network and apply the
 * global startDate filter to the merged results.
 * @param args - Bundled inputs (disc, fc).
 * @returns Filtered accounts ready for the SCRAPE step result.
 */
async function scrapeWithFrozen(args: IScrapeFrozenArgs): Promise<readonly ITransactionsAccount[]> {
  const loadCtx = buildFrozenLoadCtx(args.disc, args.fc, args.fc.txnEndpoint);
  const raw = await scrapeAllAccounts(loadCtx);
  const merged = await mergePendingFor({ fc: args.fc, loadCtx, raw });
  const filterMs = parseStartDate(args.fc.startDate).getTime();
  applyGlobalDateFilter(merged, filterMs);
  return merged;
}

/**
 * Log the scrape result and wrap it into the SCRAPE-step procedure.
 * @param input - Sealed action context to thread through.
 * @param accounts - Final scraped + merged + filtered accounts.
 * @returns Succeed procedure with scrape.accounts populated.
 */
function finalizeFrozenResult(
  input: IActionContext,
  accounts: readonly ITransactionsAccount[],
): Procedure<IActionContext> {
  logScrapeResult(accounts);
  const scrape = some({ accounts: [...accounts] });
  return succeed({ ...input, scrape });
}

/**
 * Execute frozen DIRECT scrape after guards pass.
 * @param input - Sealed action context.
 * @param disc - Narrowed scrape discovery.
 * @returns Updated context with scrape.accounts populated.
 */
async function runFrozenScrape(
  input: IActionContext,
  disc: IScrapeDiscovery,
): Promise<Procedure<IActionContext>> {
  const api = await resolveFrozenApi(input);
  const fc = buildFrozenFetchCtx({ input, disc, api });
  const accounts = await scrapeWithFrozen({ disc, fc });
  return finalizeFrozenResult(input, accounts);
}

/**
 * Resolve API context for frozen scrape — uses DASHBOARD api with late-bound headers.
 * Late-binding ensures SPA headers are resolved at call time from the live network.
 * @param input - Sealed action context.
 * @returns DASHBOARD API context (late-bound to live network headers).
 */
function resolveFrozenApi(input: IActionContext): Promise<IApiFetchContext> {
  if (input.api.has) return Promise.resolve(input.api.value);
  return Promise.resolve({} as IApiFetchContext);
}

/**
 * Build the frozen load context from discovery. Phase 7f: the slim
 * `ITxnEndpoint` is supplied by the caller — this helper never re-runs
 * discovery.
 * @param disc - Scrape discovery state.
 * @param fc - Account fetch context.
 * @param txnEndpoint - Slim TXN endpoint resolved upstream.
 * @returns Fetch-all-accounts context.
 */
function buildFrozenLoadCtx(
  disc: IScrapeDiscovery,
  fc: IAccountFetchCtx,
  txnEndpoint: ITxnEndpoint,
): IFetchAllAccountsCtx {
  const ids = disc.accountIds ?? disc.qualifiedCards;
  const records = disc.rawAccountRecords ?? [];
  LOG.debug({ message: `[ACTION] frozen: ${String(ids.length)} accts` });
  return { fc, ids, records, txnEndpoint };
}

/**
 * Pick the frozen-replay TXN endpoint: prefer the ctx-committed value
 * (DASHBOARD.FINAL); fall back to the snapshot frozen onto
 * `IScrapeDiscovery.txnEndpoint` at SCRAPE.PRE time.
 * @param fromCtx - Slim endpoint read from ctx.txnEndpoint.
 * @param fromDiscovery - Snapshot frozen onto IScrapeDiscovery at PRE.
 * @returns Resolved slim endpoint (caller's url=='' signals empty).
 */
function pickFrozenTxnEndpoint(
  fromCtx: ITxnEndpoint,
  fromDiscovery: ITxnEndpoint | false,
): ITxnEndpoint {
  if (fromCtx.url !== '') return fromCtx;
  // Discovery snapshot may be `false` (legacy mock) — that case
  // collapses to the EMPTY default already carried by fromCtx.
  if (fromDiscovery === false) return fromCtx;
  return fromDiscovery;
}

/**
 * Log scrape result summary.
 * @param accounts - Scraped accounts with txns.
 * @returns True after logging.
 */
function logScrapeResult(accounts: readonly ITransactionsAccount[]): boolean {
  let totalTxns = 0;
  for (const acct of accounts) totalTxns += acct.txns.length;
  LOG.debug({ accounts: accounts.length, txns: totalTxns });
  return true;
}

export default executeFrozenDirectScrape;
export { executeFrozenDirectScrape };
