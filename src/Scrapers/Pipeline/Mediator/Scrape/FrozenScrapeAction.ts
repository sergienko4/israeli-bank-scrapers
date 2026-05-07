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
import { createFrozenNetwork } from '../Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { readBillingUrl, readPendingUrl, readTxnEndpoint } from './TxnEndpointBridge.js';

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
  const dashboardClickAt = disc.dashboardClickAt ?? false;
  const frozen = createFrozenNetwork(frozenEps, cachedAuth, dashboardClickAt);
  const api = await resolveFrozenApi(input);
  const startDate = moment(input.options.startDate).format('YYYYMMDD');
  const futureMonths = getFutureMonths(input.options);
  // Phase 7e: source the TXN endpoint via the bridge — DASHBOARD.FINAL's
  // ctx.txnEndpoint is preferred; the frozen network is only consulted if
  // DASHBOARD skipped the commit (mock-mode bypass / FrozenScrape replay).
  const txnEndpoint = readTxnEndpoint(input);
  const pendingUrl = readPendingUrl(input);
  const billingUrl = readBillingUrl(input);
  const fc: IAccountFetchCtx = {
    api,
    network: frozen,
    startDate,
    futureMonths,
    txnEndpoint,
    pendingUrl,
    billingUrl,
  };
  const loadCtx = buildFrozenLoadCtx(disc, fc, txnEndpoint);
  const rawAccounts = await scrapeAllAccounts(loadCtx);
  const withPending = await fetchAndMergePending({
    api,
    accounts: rawAccounts,
    accountRecords: loadCtx.records,
    pendingUrl,
  });
  const filterMs = parseStartDate(startDate).getTime();
  applyGlobalDateFilter(withPending, filterMs);
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
 * Build the frozen load context from discovery. Phase 7e: the TXN endpoint
 * is supplied by the caller (read via {@link readTxnEndpoint}) — this helper
 * never re-runs discovery.
 * @param disc - Scrape discovery state.
 * @param fc - Account fetch context.
 * @param txnEndpoint - TXN endpoint resolved upstream.
 * @returns Fetch-all-accounts context.
 */
function buildFrozenLoadCtx(
  disc: IScrapeDiscovery,
  fc: IAccountFetchCtx,
  txnEndpoint: IDiscoveredEndpoint | false,
): IFetchAllAccountsCtx {
  const ids = disc.accountIds ?? disc.qualifiedCards;
  const records = disc.rawAccountRecords ?? [];
  const resolved = pickFrozenTxnEndpoint(txnEndpoint, disc.txnEndpoint ?? false);
  LOG.debug({ message: `[ACTION] frozen: ${String(ids.length)} accts` });
  return { fc, ids, records, txnEndpoint: resolved };
}

/**
 * Pick the frozen-replay TXN endpoint: prefer the bridge-supplied value
 * (sourced from `ctx.txnEndpoint`); fall back to the value frozen into
 * `IScrapeDiscovery.txnEndpoint` at PRE time. Returns `false` only when
 * both sources are absent.
 * @param fromBridge - Value supplied by readTxnEndpoint via ctx.
 * @param fromDiscovery - Value frozen onto IScrapeDiscovery at PRE.
 * @returns Resolved endpoint or `false`.
 */
function pickFrozenTxnEndpoint(
  fromBridge: IDiscoveredEndpoint | false,
  fromDiscovery: IDiscoveredEndpoint | false,
): IDiscoveredEndpoint | false {
  if (fromBridge !== false) return fromBridge;
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
