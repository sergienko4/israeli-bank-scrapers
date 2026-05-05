/**
 * SCRAPE phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    forensic priming + endpoint discovery + freeze (DIRECT)
 * ACTION: frozen matrix loop (no browser, no network — sealed)
 * POST:   audit diagnostics (forensic audit table)
 * FINAL:  stamp account count for audit trail
 */

import moment from 'moment';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { harvestAccountsFromStorage } from '../../Mediator/Scrape/AccountBootstrap.js';
import {
  applyCredentialFallback,
  buildLoadAllCtx,
  discoverAndLoadAccounts,
  pivotToSpaIfNeeded,
} from '../../Strategy/Scrape/GenericAutoScrapeStrategy.js';
import type { IAccountFetchCtx, IFetchAllAccountsCtx } from '../../Strategy/Scrape/ScrapeTypes.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import { type IActionContext, type IPipelineContext } from '../../Types/PipelineContext.js';
import { fail, isOk, type Procedure, succeed } from '../../Types/Procedure.js';
import { getFutureMonths } from '../../Types/ScraperDefaults.js';
import { triggerDashboardUi } from '../Dashboard/DashboardTrigger.js';
import { logForensicAudit } from './ForensicAuditAction.js';
import { executeFrozenDirectScrape } from './FrozenScrapeAction.js';

const LOG = createLogger('scrape-phase');

/**
 * Build the base diagnostics for scrape PRE.
 * @param input - Pipeline context.
 * @returns Updated diagnostics with fetchStartMs.
 */
function buildPreDiag(input: IPipelineContext): IPipelineContext['diagnostics'] {
  const nowMs = Date.now();
  return { ...input.diagnostics, fetchStartMs: some(nowMs), lastAction: 'scrape-pre' };
}

/**
 * Run forensic priming if dashboard was not primed.
 * Delegates to Mediator's triggerDashboardUi — zero WK in Phase.
 * @param input - Pipeline context.
 * @returns Procedure after priming attempt.
 */
async function maybeForensicPrime(input: IPipelineContext): Promise<Procedure<boolean>> {
  const isPrimed = !input.dashboard.has || input.dashboard.value.trafficPrimed;
  if (isPrimed || !input.mediator.has) return succeed(true);
  input.logger.debug({
    message: 'trafficPrimed=false -> Forensic via Mediator',
  });
  return triggerDashboardUi(input.mediator.value, input.logger);
}

/**
 * DIRECT path: discover endpoints + load accounts + freeze network.
 * Runs SPA pivot, endpoint discovery, account loading, storage harvest.
 * Stores everything in scrapeDiscovery for sealed ACTION.
 * @param input - Pipeline context with mediator + api.
 * @param diag - Updated diagnostics.
 * @returns Updated context with frozen scrapeDiscovery.
 */
async function executeDirectDiscovery(
  input: IPipelineContext,
  diag: IPipelineContext['diagnostics'],
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has || !input.api.has) {
    return succeed({ ...input, diagnostics: diag });
  }
  const api = input.api.value;
  const network = input.mediator.value.network;
  const mediator = input.mediator.value;

  await pivotToSpaIfNeeded(mediator, network);
  const rawResult = await discoverAndLoadAccounts(api, network);
  if (!isOk(rawResult)) return fail(rawResult.errorType, rawResult.errorMessage);

  const startDate = moment(input.options.startDate).format('YYYYMMDD');
  const futureMonths = getFutureMonths(input.options);
  const fc: IAccountFetchCtx = { api, network, startDate, futureMonths };
  let loadCtx = buildLoadAllCtx(fc, network, rawResult.value);
  loadCtx = applyCredentialFallback(loadCtx, input);
  loadCtx = await applyStorageHarvestPre(loadCtx, input);

  // Fail-fast only when traffic was observed but extraction couldn't
  // resolve a usable identifier — that's the dangerous case (the silent
  // 'default' bug). When no transaction endpoint was captured at all,
  // upstream phases didn't reach that signal yet; let the empty-accounts
  // result flow through so the assertSuccessfulScrape assertion fires
  // its own (loud) regression message instead of masking it here.
  if (loadCtx.ids.length === 0 && loadCtx.txnEndpoint !== false) {
    return fail(
      ScraperErrorTypes.Generic,
      'scrape: no usable account identifier found in captured network',
    );
  }

  const frozenEndpoints = network.getAllEndpoints();
  const cachedAuth = await network.discoverAuthToken();
  const storageHarvest = await collectStorageSafe(input);

  const idCount = String(loadCtx.ids.length);
  const recCount = String(loadCtx.records.length);
  const epCount = String(frozenEndpoints.length);
  LOG.debug({
    message: `[PRE] DIRECT: ${idCount} accts, ${recCount} recs, ${epCount} eps frozen`,
  });

  const disc = {
    qualifiedCards: [...loadCtx.ids],
    prunedCards: [] as string[],
    txnTemplateUrl: '',
    txnTemplateBody: {} as Record<string, unknown>,
    billingMonths: [] as string[],
    frozenEndpoints: [...frozenEndpoints],
    accountIds: [...loadCtx.ids],
    rawAccountRecords: [...loadCtx.records],
    txnEndpoint: loadCtx.txnEndpoint,
    cachedAuth,
    storageHarvest,
  };

  return succeed({
    ...input,
    diagnostics: diag,
    scrapeDiscovery: some(disc),
  });
}

/**
 * Harvest accounts from sessionStorage (full context).
 * @param loadCtx - Current load context.
 * @param ctx - Pipeline context with browser.
 * @returns Updated load context with seeded IDs.
 */
async function applyStorageHarvestPre(
  loadCtx: IFetchAllAccountsCtx,
  ctx: IPipelineContext,
): Promise<IFetchAllAccountsCtx> {
  if (loadCtx.ids.length > 0) return loadCtx;
  if (!ctx.browser.has) return loadCtx;
  const page = ctx.browser.value.page;
  const result = await harvestAccountsFromStorage(page);
  if (result.ids.length === 0) return loadCtx;
  return { ...loadCtx, ids: [...result.ids], records: [...result.records] };
}

/**
 * Collect sessionStorage safely.
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

/**
 * PRE: Forensic priming + DIRECT discovery. After .ashx removal there is
 * exactly one strategy — DIRECT.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics + scrapeDiscovery.
 */
async function executeForensicPre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  await maybeForensicPrime(input);
  const diag = buildPreDiag(input);
  return executeDirectDiscovery(input, diag);
}

/**
 * ACTION (sealed): Frozen matrix loop — uses scrapeDiscovery + api only.
 * @param input - Sealed action context.
 * @returns Updated context with scraped accounts.
 */
async function executeMatrixLoop(input: IActionContext): Promise<Procedure<IActionContext>> {
  return executeFrozenDirectScrape(input);
}

/**
 * POST: Audit diagnostics — forensic audit table for qualified/pruned cards.
 * @param input - Pipeline context after scraping.
 * @returns Updated context with post diagnostics.
 */
function executeValidateResults(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const accountCount = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const countStr = String(accountCount);
  if (input.scrape.has) logForensicAudit(input);
  warnZeroAmounts(input);
  const diag = { ...input.diagnostics, lastAction: `scrape-post (${countStr} accounts)` };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

/** Transaction amount fields for zero-check. */
interface IAmountFields {
  readonly chargedAmount: number;
  readonly originalAmount: number;
}

/** Zero-amount audit result. */
interface IZeroAudit {
  readonly total: number;
  readonly zeros: number;
}

/**
 * Check if a transaction has zero charged AND original.
 * @param txn - Transaction amount fields.
 * @returns True if both amounts are zero.
 */
function isZeroAmountTxn(txn: IAmountFields): boolean {
  return txn.chargedAmount === 0 && txn.originalAmount === 0;
}

/**
 * Count zero-amount transactions across all accounts.
 * @param accounts - Scraped accounts.
 * @returns Total txn count and zero-amount count.
 */
function countZeroAmounts(accounts: readonly { txns: readonly IAmountFields[] }[]): IZeroAudit {
  const allTxns = accounts.flatMap((a): readonly IAmountFields[] => a.txns);
  const zeros = allTxns.filter(isZeroAmountTxn).length;
  return { total: allTxns.length, zeros };
}

/**
 * Warn if all transaction amounts are 0.00 — diagnostic, not failure.
 * Returns true only when a warning was actually emitted (all txns zero);
 * the no-op branches (no scrape, empty accounts, mixed amounts) return
 * false so the function carries semantic information instead of always
 * yielding the same sentinel.
 * @param input - Pipeline context after scraping.
 * @returns True when the all-zero warning fired.
 */
function warnZeroAmounts(input: IPipelineContext): boolean {
  if (!input.scrape.has) return false;
  const accounts = input.scrape.value.accounts;
  if (accounts.length === 0) return false;
  const { total, zeros } = countZeroAmounts(accounts);
  if (total === 0) return false;
  if (zeros !== total) return false;
  input.logger.warn({
    message: `ALL ${String(total)} transactions have 0.00 amounts`,
  });
  return true;
}

/**
 * FINAL: Stamp account count for audit trail.
 * @param input - Pipeline context with scrape state.
 * @returns Updated context with lastAction diagnostic.
 */
function executeStampAccounts(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const count = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const label = `scrape-final (${String(count)} accounts)`;
  const diag = { ...input.diagnostics, lastAction: label };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

export { executeForensicPre, executeMatrixLoop, executeStampAccounts, executeValidateResults };
