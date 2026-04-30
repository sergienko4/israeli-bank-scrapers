/**
 * Frozen DIRECT scrape — sealed execution with frozen network.
 * Rebuilds API context with frozen headers (SPA-specific included).
 * Extracted from ScrapePhaseActions to respect max-dependencies.
 */

import moment from 'moment';

import type { ITransactionsAccount } from '../../../../Transactions.js';
import { fetchAndMergePending } from '../../Strategy/Scrape/Account/PendingStrategy.js';
import { scrapeAllAccounts } from '../../Strategy/Scrape/Account/ScrapeDispatch.js';
import { applyGlobalDateFilter, parseStartDate } from '../../Strategy/Scrape/ScrapeDataActions.js';
import type { IAccountFetchCtx, IFetchAllAccountsCtx } from '../../Strategy/Scrape/ScrapeTypes.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import {
  type IActionContext,
  type IApiFetchContext,
  type IScrapeDiscovery,
} from '../../Types/PipelineContext.js';
import { type Procedure, succeed } from '../../Types/Procedure.js';
import { getFutureMonths } from '../../Types/ScraperDefaults.js';
import { createFrozenNetwork, type INetworkDiscovery } from '../Network/NetworkDiscovery.js';

const LOG = createLogger('frozen-scrape');

/** Whether scrape result was logged. */
type DidLog = boolean;

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
 * Guard: check preconditions for frozen scrape.
 * @param input - Sealed action context.
 * @returns Succeed(input) if should skip, false if ready.
 */
function guardFrozenScrape(input: IActionContext): Procedure<IActionContext> | false {
  if (!input.scrapeDiscovery.has) {
    LOG.debug({ message: '[ACTION] no scrapeDiscovery — skipping' });
    return succeed(input);
  }
  if (!input.api.has) return succeed(input);
  const frozenEps = input.scrapeDiscovery.value.frozenEndpoints ?? [];
  if (frozenEps.length === 0) {
    LOG.debug({ message: '[ACTION] no frozen endpoints — skipping' });
    return succeed(input);
  }
  return false;
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
  const frozenEps = disc.frozenEndpoints ?? [];
  const cachedAuth = disc.cachedAuth ?? false;
  const frozen = createFrozenNetwork(frozenEps, cachedAuth);
  const api = await resolveFrozenApi(input);
  const startDate = moment(input.options.startDate).format('YYYYMMDD');
  const futureMonths = getFutureMonths(input.options);
  const fc: IAccountFetchCtx = { api, network: frozen, startDate, futureMonths };
  const loadCtx = buildFrozenLoadCtx(disc, fc, frozen);
  const rawAccounts = await scrapeAllAccounts(loadCtx);
  const withPending = await fetchAndMergePending({
    api,
    network: frozen,
    accounts: rawAccounts,
    accountRecords: loadCtx.records,
  });
  const filterMs = parseStartDate(startDate).getTime();
  applyGlobalDateFilter(withPending as ITransactionsAccount[], filterMs);
  logScrapeResult(withPending);
  return succeed({ ...input, scrape: some({ accounts: [...withPending] }) });
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
 * Build the frozen load context from discovery.
 * @param disc - Scrape discovery state.
 * @param fc - Account fetch context.
 * @param frozen - Frozen network.
 * @returns Fetch-all-accounts context.
 */
function buildFrozenLoadCtx(
  disc: IScrapeDiscovery,
  fc: IAccountFetchCtx,
  frozen: INetworkDiscovery,
): IFetchAllAccountsCtx {
  const ids = disc.accountIds ?? disc.qualifiedCards;
  const records = disc.rawAccountRecords ?? [];
  const txnEndpoint = disc.txnEndpoint ?? frozen.discoverTransactionsEndpoint();
  LOG.debug({ message: `[ACTION] frozen: ${String(ids.length)} accts` });
  return { fc, ids, records, txnEndpoint };
}

/**
 * Log scrape result summary.
 * @param accounts - Scraped accounts with txns.
 * @returns True after logging.
 */
function logScrapeResult(accounts: readonly ITransactionsAccount[]): DidLog {
  let totalTxns = 0;
  for (const acct of accounts) totalTxns += acct.txns.length;
  LOG.debug({ accounts: accounts.length, txns: totalTxns });
  return true;
}

export default executeFrozenDirectScrape;
export { executeFrozenDirectScrape };
