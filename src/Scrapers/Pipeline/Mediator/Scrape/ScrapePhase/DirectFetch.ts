/**
 * SCRAPE.PRE — DIRECT discovery leaf helpers (Phase 8.5b C5).
 *
 * <p>Types + side-effect-free helpers consumed by
 * {@link ./DirectActions.ts}'s composers. Network types are erased
 * via Pick / Extract / ReturnType on safe imports so this file does
 * NOT need to be added to NET_SCRAPE_ALLOWLIST.
 */

import moment from 'moment';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { FALLBACK_DEDUP_KEY_FIELDS } from '../../../Strategy/Scrape/ScrapeDataActions.js';
import {
  type IAccountFetchCtx,
  type IFetchAllAccountsCtx,
} from '../../../Strategy/Scrape/ScrapeTypes.js';
import { type IScrapeDiscovery } from '../../../Types/Domain/ScrapeDiscoveryTypes.js';
import { type IPipelineContext } from '../../../Types/PipelineContext.js';
import { fail, type Procedure } from '../../../Types/Procedure.js';
import { getFutureMonths } from '../../../Types/ScraperDefaults.js';
import { LOG } from './Diag.js';
import type { readDashboardTxnHarvest, readPreDiscoveredTxn } from './PreDiscovery.js';
import {
  readBillingCycleCatalog,
  readDateWindowParams,
  readDedupKeyFields,
  readPreDiscoveredAccounts,
} from './PreDiscovery.js';

type IMediatorValue = Extract<IPipelineContext['mediator'], { has: true }>['value'];
type IApiValue = Extract<IPipelineContext['api'], { has: true }>['value'];
type IProc = Procedure<IPipelineContext>;
type IRefFields = Pick<IAccountFetchCtx, 'api' | 'network' | 'txnEndpoint' | 'dashboardTxnHarvest'>;
type IDerivedFields = Pick<
  IAccountFetchCtx,
  'startDate' | 'futureMonths' | 'billingCycleCatalog' | 'dedupKeyFields' | 'dateWindowParams'
>;

const NO_ACCT_ID_MSG = 'scrape: no usable account identifier in ctx.accountDiscovery';

/** SPA-pivot + pre-discovery reads (network, txnEndpoint, harvest). */
interface IDirectPreReads {
  readonly network: IAccountFetchCtx['network'];
  readonly txnEndpoint: ReturnType<typeof readPreDiscoveredTxn>;
  readonly harvest: ReturnType<typeof readDashboardTxnHarvest>;
}

/** Narrowed pipeline-context handle (mediator + api guaranteed present). */
interface IReadyHandle {
  readonly input: IPipelineContext;
  readonly mediator: IMediatorValue;
  readonly api: IApiValue;
}

/** Frozen-network state captured by {@link freezeNetworkSnapshot}. */
interface IFreezeSnapshot {
  readonly frozenEndpoints: ReturnType<IAccountFetchCtx['network']['getAllEndpoints']>;
  readonly cachedAuth: Awaited<ReturnType<IAccountFetchCtx['network']['discoverAuthToken']>>;
  readonly storageHarvest: Record<string, string>;
  readonly dashboardClickAt: ReturnType<IAccountFetchCtx['network']['getDashboardClickAt']>;
}

/** Bundled args for the fetch-ctx + load-ctx builders. */
interface IFetchCtxArgs {
  readonly ready: IReadyHandle;
  readonly reads: IDirectPreReads;
}

/** Bundled args for the discovery-state builder + log. */
interface IDiscBuildArgs {
  readonly loadCtx: IFetchAllAccountsCtx;
  readonly snapshot: IFreezeSnapshot;
}

/**
 * Pick the four reference-only fields onto the fetch context.
 *
 * @param args - Bundled ready handle + reads.
 * @returns Ref fields slice.
 */
function buildRefFields(args: IFetchCtxArgs): IRefFields {
  return {
    api: args.ready.api,
    network: args.reads.network,
    txnEndpoint: args.reads.txnEndpoint,
    dashboardTxnHarvest: args.reads.harvest,
  };
}

/**
 * Compute the five derived fields of the fetch context.
 *
 * @param args - Bundled ready handle + reads.
 * @returns Derived fields slice.
 */
function buildDerivedFields(args: IFetchCtxArgs): IDerivedFields {
  return {
    startDate: moment(args.ready.input.options.startDate).format('YYYYMMDD'),
    futureMonths: getFutureMonths(args.ready.input.options),
    billingCycleCatalog: readBillingCycleCatalog(args.ready.input),
    dedupKeyFields: readDedupKeyFields(args.reads.harvest, FALLBACK_DEDUP_KEY_FIELDS),
    dateWindowParams: readDateWindowParams(args.reads.harvest),
  };
}

/**
 * Build the {@link IAccountFetchCtx} by merging ref + derived slices.
 *
 * @param args - Bundled ready handle + reads.
 * @returns Fully populated fetch context.
 */
function buildAccountFetchCtx(args: IFetchCtxArgs): IAccountFetchCtx {
  return { ...buildRefFields(args), ...buildDerivedFields(args) };
}

/**
 * Compose the {@link IFetchAllAccountsCtx} from reads + pre-resolved accounts.
 *
 * @param args - Bundled ready handle + reads.
 * @returns Partial inputs the caller stitches via buildLoadCtxFromPreDiscovered.
 */
function buildLoadCtxInputs(args: IFetchCtxArgs): {
  fc: IAccountFetchCtx;
  ids: ReturnType<typeof readPreDiscoveredAccounts>['ids'];
  records: ReturnType<typeof readPreDiscoveredAccounts>['records'];
  txnEndpoint: IDirectPreReads['txnEndpoint'];
  harvest: IDirectPreReads['harvest'];
} {
  const fc = buildAccountFetchCtx(args);
  const ad = readPreDiscoveredAccounts(args.ready.input);
  const { reads } = args;
  return {
    fc,
    ids: ad.ids,
    records: ad.records,
    txnEndpoint: reads.txnEndpoint,
    harvest: reads.harvest,
  };
}

/**
 * Defense-in-depth: refuse to scrape when account ids are missing
 * but the txn endpoint is set (sentinel-id avoidance).
 *
 * @param loadCtx - Fetch-all-accounts context to validate.
 * @returns Failure procedure when invalid, else false.
 */
function checkLoadCtxValid(loadCtx: IFetchAllAccountsCtx): IProc | false {
  if (loadCtx.ids.length === 0 && (loadCtx.txnEndpoint?.url ?? '') !== '') {
    return fail(ScraperErrorTypes.Generic, NO_ACCT_ID_MSG);
  }
  return false;
}

/**
 * Snapshot the network's frozen state for sealed ACTION consumption:
 * endpoints, cached auth, storage harvest, dashboard-click marker.
 *
 * @param network - Live network discovery.
 * @param input - Pipeline context for storage harvest.
 * @returns Bundled snapshot.
 */
async function freezeNetworkSnapshot(
  network: IAccountFetchCtx['network'],
  input: IPipelineContext,
): Promise<IFreezeSnapshot> {
  const frozenEndpoints = network.getAllEndpoints();
  const cachedAuth = await network.discoverAuthToken();
  const storageHarvest = await collectStorageSafe(input);
  const dashboardClickAt = network.getDashboardClickAt();
  return { frozenEndpoints, cachedAuth, storageHarvest, dashboardClickAt };
}

/**
 * Build the 8 DIRECT-path live fields of {@link IScrapeDiscovery}.
 *
 * @param args - Bundled loadCtx + snapshot.
 * @returns Partial discovery state with DIRECT-only fields.
 */
function buildLiveDiscoveryFields(args: IDiscBuildArgs): Partial<IScrapeDiscovery> {
  return {
    qualifiedCards: [...args.loadCtx.ids],
    frozenEndpoints: [...args.snapshot.frozenEndpoints],
    accountIds: [...args.loadCtx.ids],
    rawAccountRecords: [...args.loadCtx.records],
    txnEndpoint: args.loadCtx.txnEndpoint,
    cachedAuth: args.snapshot.cachedAuth,
    storageHarvest: args.snapshot.storageHarvest,
    dashboardClickAt: args.snapshot.dashboardClickAt,
  };
}

/**
 * Build the SCRAPE.PRE discovery state literal from loadCtx + snapshot.
 *
 * @param args - Bundled loadCtx + snapshot.
 * @returns Discovery state to commit.
 */
function buildScrapeDiscoveryState(args: IDiscBuildArgs): IScrapeDiscovery {
  logFrozenPreCounts(args);
  const defaults = { prunedCards: [], txnTemplateUrl: '', txnTemplateBody: {}, billingMonths: [] };
  return { ...defaults, ...buildLiveDiscoveryFields(args) } as IScrapeDiscovery;
}

/**
 * Emit the [PRE] DIRECT debug log line with ids/records/eps counts.
 *
 * @param args - Bundled loadCtx + snapshot.
 * @returns Always true (log side-effect signal).
 */
function logFrozenPreCounts(args: IDiscBuildArgs): boolean {
  const idCount = String(args.loadCtx.ids.length);
  const recCount = String(args.loadCtx.records.length);
  const epCount = String(args.snapshot.frozenEndpoints.length);
  LOG.debug({ message: `[PRE] DIRECT: ${idCount} accts, ${recCount} recs, ${epCount} eps frozen` });
  return true;
}

/**
 * Collect sessionStorage safely (empty when no browser / on eval error).
 *
 * @param ctx - Pipeline context.
 * @returns Storage key-value pairs or empty.
 */
async function collectStorageSafe(ctx: IPipelineContext): Promise<Record<string, string>> {
  if (!ctx.browser.has) return {};
  const page = ctx.browser.value.page;
  return page
    .evaluate((): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const key of Object.keys(sessionStorage)) out[key] = sessionStorage.getItem(key) ?? '';
      return out;
    })
    .catch((): Record<string, string> => ({}));
}

export {
  buildLoadCtxInputs,
  buildScrapeDiscoveryState,
  checkLoadCtxValid,
  collectStorageSafe,
  freezeNetworkSnapshot,
  type IDirectPreReads,
  type IReadyHandle,
};
