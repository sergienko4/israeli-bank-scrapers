/**
 * PreDiscovery — pure readers for SCRAPE.PRE inputs.
 *
 * Each function reads a pre-discovered slice from the pipeline
 * context committed by upstream phases (ACCOUNT-RESOLVE.POST or
 * DASHBOARD.FINAL). Returns sealed empty sentinels on miss so
 * callers never branch on `Option.has`.
 *
 * Extracted from ScrapePhaseActions.ts in Phase 8.5b C4.
 */

import { EMPTY_TXN_ENDPOINT } from '../../../Strategy/Scrape/ScrapeTypes.js';
import {
  EMPTY_TXN_HARVEST,
  type IActionContext,
  type IBillingCycleCatalog,
  type IDashboardTxnHarvest,
  type IPipelineContext,
  type ITxnEndpoint,
} from '../../../Types/PipelineContext.js';

/** Pre-discovered account list bundle (or empty when missing). */
interface IPreDiscoveredAccounts {
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
}

/**
 * Reads the account list ACCOUNT-RESOLVE.POST committed to
 * `ctx.accountDiscovery`. Returns empty arrays when the option
 * is absent — the pipeline invariant from Phase 7+7b prevents that
 * case from reaching SCRAPE on a successful run, so an empty result
 * here is a programming error rather than a recoverable state.
 * @param input - Pipeline context.
 * @returns Pre-discovered account ids + records (empties on miss).
 */
function readPreDiscoveredAccounts(input: IPipelineContext): IPreDiscoveredAccounts {
  if (!input.accountDiscovery.has) return { ids: [], records: [] };
  return {
    ids: input.accountDiscovery.value.ids,
    records: input.accountDiscovery.value.records,
  };
}

/**
 * Reads the TXN endpoint DASHBOARD.FINAL committed to
 * `ctx.txnEndpoint`. Mirror of {@link readPreDiscoveredAccounts} —
 * pure read, no adapter, no network surface. Returns
 * {@link EMPTY_TXN_ENDPOINT} when the option is absent so callers
 * never branch on `Option.has` themselves.
 *
 * @param input - Pipeline context.
 * @returns Slim TXN endpoint (or EMPTY_TXN_ENDPOINT on miss).
 */
function readPreDiscoveredTxn(input: IPipelineContext | IActionContext): ITxnEndpoint {
  const opt = (input as { readonly txnEndpoint?: IPipelineContext['txnEndpoint'] }).txnEndpoint;
  if (!opt?.has) return EMPTY_TXN_ENDPOINT;
  return opt.value;
}

/**
 * Reads the DASHBOARD-side harvest committed by DASHBOARD.FINAL on
 * `ctx.dashboardTxnHarvest`. Returns {@link EMPTY_TXN_HARVEST} when
 * the option is absent so callers never branch on `Option.has`.
 *
 * @param input - Pipeline context.
 * @returns Harvest payload (empty when DASHBOARD did not commit).
 */
function readDashboardTxnHarvest(input: IPipelineContext | IActionContext): IDashboardTxnHarvest {
  const opt = (input as { readonly dashboardTxnHarvest?: IPipelineContext['dashboardTxnHarvest'] })
    .dashboardTxnHarvest;
  if (!opt?.has) return EMPTY_TXN_HARVEST;
  return opt.value;
}

/**
 * Reads the per-card dedup-key field tuple from the harvest's
 * `dedupKeyFieldsByAccount` map. Phase G: DASHBOARD picks one tuple
 * per capture; in practice the map has one entry, so the first value
 * applies to every per-account dedup downstream.
 *
 * @param harvest - DASHBOARD harvest (may be `EMPTY_TXN_HARVEST`).
 * @param fallback - Tuple returned when no map entry is present.
 * @returns Resolved dedup-key field tuple.
 */
function readDedupKeyFields(
  harvest: IDashboardTxnHarvest,
  fallback: readonly string[],
): readonly string[] {
  const map = harvest.dedupKeyFieldsByAccount;
  if (map === undefined || map.size === 0) return fallback;
  const iterResult = map.values().next();
  if (iterResult.done) return fallback;
  return iterResult.value;
}

/** Empty WK-alias tuple — used when the harvest carries no detected pair. */
const EMPTY_DATE_WINDOW_PARAMS: readonly string[] = Object.freeze([]);

/**
 * Reads the per-card WK-aliased `[fromAlias, toAlias]` tuple from the
 * harvest's `dateWindowParamsByAccount` map. Returns
 * {@link EMPTY_DATE_WINDOW_PARAMS} when DASHBOARD did not emit a map
 * entry (empty harvest, multi-account-scope skip, or no WK alias pair
 * observed in the pool).
 *
 * @param harvest - DASHBOARD harvest (may be `EMPTY_TXN_HARVEST`).
 * @returns Resolved `[fromAlias, toAlias]` tuple or empty array.
 */
function readDateWindowParams(harvest: IDashboardTxnHarvest): readonly string[] {
  const map = harvest.dateWindowParamsByAccount;
  if (map === undefined || map.size === 0) return EMPTY_DATE_WINDOW_PARAMS;
  const iterResult = map.values().next();
  if (iterResult.done) return EMPTY_DATE_WINDOW_PARAMS;
  return iterResult.value;
}

/** Empty catalog sentinel — used as the "no catalog" return value. */
const EMPTY_CATALOG: IBillingCycleCatalog = { cycles: [] };

/**
 * Reads the billing-cycle catalog committed by ACCOUNT-RESOLVE.POST
 * on `ctx.accountDiscovery.value.billingCycleCatalog`. Returns the
 * {@link EMPTY_CATALOG} sentinel when the option is absent or when
 * ACCOUNT-RESOLVE found no recognised cycle shape.
 *
 * @param input - Pipeline context.
 * @returns Catalog when present; empty sentinel otherwise.
 */
function readBillingCycleCatalog(input: IPipelineContext | IActionContext): IBillingCycleCatalog {
  const opt = (input as { readonly accountDiscovery?: IPipelineContext['accountDiscovery'] })
    .accountDiscovery;
  if (!opt?.has) return EMPTY_CATALOG;
  return opt.value.billingCycleCatalog ?? EMPTY_CATALOG;
}

export {
  EMPTY_CATALOG,
  EMPTY_DATE_WINDOW_PARAMS,
  type IPreDiscoveredAccounts,
  readBillingCycleCatalog,
  readDashboardTxnHarvest,
  readDateWindowParams,
  readDedupKeyFields,
  readPreDiscoveredAccounts,
  readPreDiscoveredTxn,
};
