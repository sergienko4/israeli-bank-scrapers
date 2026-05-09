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
import {
  buildLoadCtxFromPreDiscovered,
  pivotToSpaIfNeeded,
} from '../../Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { EMPTY_TXN_ENDPOINT, type IAccountFetchCtx } from '../../Strategy/Scrape/ScrapeTypes.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import {
  EMPTY_TXN_HARVEST,
  type IActionContext,
  type IDashboardTxnHarvest,
  type IPipelineContext,
  type ITxnEndpoint,
} from '../../Types/PipelineContext.js';
import { fail, type Procedure, succeed } from '../../Types/Procedure.js';
import { getFutureMonths } from '../../Types/ScraperDefaults.js';
import { logForensicAudit } from './ForensicAuditAction.js';
import { executeFrozenDirectScrape } from './FrozenScrapeAction.js';
import { triggerDashboardUi } from './ScrapeUiTrigger.js';

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
 * <p>Phase 7f replaces the deleted `TxnEndpointBridge.readTxnEndpoint`.
 * The bridge re-shaped the typed `ITxnEndpoint` into the legacy
 * `IDiscoveredEndpoint` runtime shape so SCRAPE could keep its old
 * types — that was a back door. The new reader returns the typed
 * contract directly; SCRAPE strategies consume `ITxnEndpoint` fields
 * by name and never see `IDiscoveredEndpoint`.
 *
 * @param input - Pipeline context.
 * @returns Slim TXN endpoint (or EMPTY_TXN_ENDPOINT on miss).
 */
function readPreDiscoveredTxn(input: IPipelineContext | IActionContext): ITxnEndpoint {
  // Defensive: legacy test mocks build IActionContext without
  // `txnEndpoint`; the production type guarantees the field, but
  // mocks predate Phase 7e. Optional-chain reads the option's `has`
  // flag through both possible miss paths in one expression.
  const opt = (input as { readonly txnEndpoint?: IPipelineContext['txnEndpoint'] }).txnEndpoint;
  if (!opt?.has) return EMPTY_TXN_ENDPOINT;
  return opt.value;
}

/**
 * Reads the DASHBOARD-side harvest committed by DASHBOARD.FINAL on
 * `ctx.dashboardTxnHarvest`. Mirror of {@link readPreDiscoveredTxn}
 * and {@link readPreDiscoveredAccounts} — pure read, no adapter.
 * Returns {@link EMPTY_TXN_HARVEST} when the option is absent so
 * callers (SCRAPE strategies, tests, mock contexts) never branch on
 * `Option.has`.
 *
 * <p>SCRAPE consumes the harvest's `records` (a clean
 * `readonly ITransaction[]`) when the iteration's accountId matches
 * the captured scope — recovering the per-account fast path that
 * tryBufferedResponse provided pre-Phase-7f, but as a typed value
 * pass instead of a network-surface back door.
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

export { EMPTY_TXN_ENDPOINT } from '../../Strategy/Scrape/ScrapeTypes.js';
export { EMPTY_TXN_HARVEST } from '../../Types/PipelineContext.js';
export { readDashboardTxnHarvest, readPreDiscoveredTxn };

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

  // Phase 7f: SCRAPE consumes the slim ITxnEndpoint DASHBOARD.FINAL
  // committed to ctx.txnEndpoint. Pure read, no adapter, no fallback
  // to network re-discovery — the architecture invariant guarantees
  // the commit landed before SCRAPE starts (DASHBOARD halts otherwise
  // via F-DASH-1/2/3). pendingUrl / billingUrl live nested inside the
  // slim endpoint; sibling fields removed from IAccountFetchCtx.
  const txnEndpoint = readPreDiscoveredTxn(input);
  // Phase 7f follow-up: DASHBOARD-side harvest carries the pre-extracted
  // records DASHBOARD already saw. SCRAPE consumes them via tryFirstWave
  // when the iteration's accountId matches the captured scope, avoiding
  // the redundant per-account fetch that bank anti-bot guards reject
  // with 302 (Hapoalim-class regression).
  const harvest = readDashboardTxnHarvest(input);
  await pivotToSpaIfNeeded({ mediator, network, txnEndpoint });

  // Account discovery moved to ACCOUNT-RESOLVE.POST (Phase 7d); SCRAPE.PRE
  // consumes the pre-discovered list. TXN-endpoint discovery moved to
  // DASHBOARD.FINAL (Phase 7e); SCRAPE.PRE consumes ctx.txnEndpoint.
  const startDate = moment(input.options.startDate).format('YYYYMMDD');
  const futureMonths = getFutureMonths(input.options);
  const fc: IAccountFetchCtx = {
    api,
    network,
    startDate,
    futureMonths,
    txnEndpoint,
    dashboardTxnHarvest: harvest,
  };
  const preDiscovered = readPreDiscoveredAccounts(input);
  const loadCtx = buildLoadCtxFromPreDiscovered({
    fc,
    txnEndpoint,
    harvest,
    ids: preDiscovered.ids,
    records: preDiscovered.records,
  });

  // Defense-in-depth: ACCOUNT-RESOLVE.POST should never let an empty
  // id list through (Phase 7+7b's contract), but if it somehow does,
  // SCRAPE refuses to silently scrape a sentinel id like 'default'.
  if (loadCtx.ids.length === 0 && (loadCtx.txnEndpoint?.url ?? '') !== '') {
    return fail(
      ScraperErrorTypes.Generic,
      'scrape: no usable account identifier in ctx.accountDiscovery',
    );
  }

  const frozenEndpoints = network.getAllEndpoints();
  const cachedAuth = await network.discoverAuthToken();
  const storageHarvest = await collectStorageSafe(input);
  // Carry the dashboard-click timestamp into the frozen replay so
  // SCRAPE.ACTION's frozen network sees the same pre-nav / post-nav
  // split that the live network used during DASHBOARD.FINAL
  // validation. Without this the frozen network has no click marker
  // and falls back to the full pool, which would re-introduce the
  // pre-click widget pollution we just removed.
  const dashboardClickAt = network.getDashboardClickAt();

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
    dashboardClickAt,
  };

  return succeed({
    ...input,
    diagnostics: diag,
    scrapeDiscovery: some(disc),
  });
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
