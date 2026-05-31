/**
 * SCRAPE phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All leaf logic in `ScrapePhase/` sub-folder.
 *
 * PRE:    forensic priming + endpoint discovery + freeze (DIRECT)
 * ACTION: frozen matrix loop (no browser, no network — sealed)
 * POST:   audit diagnostics (forensic audit table)
 * FINAL:  stamp account count for audit trail
 *
 * Phase 8.5b C4 extracted leaf helpers into:
 *   • ScrapePhase/Diag.ts          (LOG, buildPreDiag, maybeForensicPrime)
 *   • ScrapePhase/PreDiscovery.ts  (6 readers + EMPTY_* + IPreDiscoveredAccounts)
 *   • ScrapePhase/Identity.ts      (identity triples)
 *   • ScrapePhase/BalanceTemplate.ts (balance-template discovery)
 *   • ScrapePhase/EmptyDetection.ts (sanity gate + zero-amount audit)
 *
 * The composer fns (executeXxx + collectStorageSafe) stay here under
 * §12A grandfather until C5 collapses this file to a shim.
 */

import moment from 'moment';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  buildLoadCtxFromPreDiscovered,
  pivotToSpaIfNeeded,
} from '../../Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { FALLBACK_DEDUP_KEY_FIELDS } from '../../Strategy/Scrape/ScrapeDataActions.js';
import { type IAccountFetchCtx } from '../../Strategy/Scrape/ScrapeTypes.js';
import { some } from '../../Types/Option.js';
import { type IActionContext, type IPipelineContext } from '../../Types/PipelineContext.js';
import { fail, type Procedure, succeed } from '../../Types/Procedure.js';
import { getFutureMonths } from '../../Types/ScraperDefaults.js';
import { logForensicAudit } from './ForensicAuditAction.js';
import { executeFrozenDirectScrape } from './FrozenScrapeAction.js';
import {
  buildIdentitiesForScrape,
  buildPreDiag,
  buildTemplateForScrape,
  decideEmptyGate,
  LOG,
  maybeForensicPrime,
  readBillingCycleCatalog,
  readDashboardTxnHarvest,
  readDateWindowParams,
  readDedupKeyFields,
  readPreDiscoveredAccounts,
  readPreDiscoveredTxn,
  warnZeroAmounts,
} from './ScrapePhase/index.js';

export { EMPTY_TXN_ENDPOINT } from '../../Strategy/Scrape/ScrapeTypes.js';
export { EMPTY_TXN_HARVEST } from '../../Types/PipelineContext.js';
export {
  readBillingCycleCatalog,
  readDashboardTxnHarvest,
  readDateWindowParams,
  readDedupKeyFields,
  readPreDiscoveredTxn,
};

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
  const billingCycleCatalog = readBillingCycleCatalog(input);
  const dedupKeyFields = readDedupKeyFields(harvest, FALLBACK_DEDUP_KEY_FIELDS);
  const dateWindowParams = readDateWindowParams(harvest);
  const fc: IAccountFetchCtx = {
    api,
    network,
    startDate,
    futureMonths,
    txnEndpoint,
    dashboardTxnHarvest: harvest,
    billingCycleCatalog,
    dedupKeyFields,
    dateWindowParams,
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
 *
 * <p>v4 Issue 2 fix: distinguishes a true scrape miss (no capture
 * pool, no 2xx responses) from a legitimate empty result (some
 * 2xx responses landed but every account returned 0 txns — happens
 * for fresh-issue cards or accounts with no activity in the window).
 *
 * @param input - Pipeline context after scraping.
 * @returns Updated context with post diagnostics.
 */
function executeValidateResults(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const accountCount = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const countStr = String(accountCount);
  if (input.scrape.has) logForensicAudit(input);
  warnZeroAmounts(input);
  const emptyDecision = decideEmptyGate(input, countStr, accountCount);
  if (emptyDecision !== false) return Promise.resolve(emptyDecision);
  const diag = { ...input.diagnostics, lastAction: `scrape-post (${countStr} accounts)` };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

/**
 * SCRAPE.post (v6) — stamp account count + emit BALANCE-RESOLVE
 * inputs onto scrape state.
 *
 * <p>Emits {@link IAccountIdentity} triples per iter accountId
 * (from accountDiscovery) and the {@link IBalanceFetchTemplate}
 * derived from the captured pool. BALANCE-RESOLVE.pre will
 * consume both and plan per-bank-account fetches.
 *
 * @param input - Pipeline context with scrape state.
 * @returns Updated context with diagnostics + identities + template.
 */
function executeStampAccounts(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const count = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const label = `scrape-final (${String(count)} accounts)`;
  const diag = { ...input.diagnostics, lastAction: label };
  if (!input.scrape.has) {
    const noScrapeNext = succeed({ ...input, diagnostics: diag });
    return Promise.resolve(noScrapeNext);
  }
  const identities = buildIdentitiesForScrape(input);
  const template = buildTemplateForScrape(input);
  const hasIdentities = identities.size > 0;
  const hasTemplate = template.url !== '';
  const scrapeWithEmit = some({
    ...input.scrape.value,
    accountIdentities: hasIdentities ? identities : undefined,
    balanceFetchTemplate: hasTemplate ? template : undefined,
  });
  const next = succeed({ ...input, diagnostics: diag, scrape: scrapeWithEmit });
  return Promise.resolve(next);
}

export { executeForensicPre, executeMatrixLoop, executeStampAccounts, executeValidateResults };
