/**
 * AccountScrape first-wave fast path — reuse the DASHBOARD-side harvest
 * before issuing a fresh per-account fetch. Extracted from
 * AccountScrapeStrategy.ts during the Phase 12e file-size drain so each
 * concern stays under `max-lines:150`.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import {
  readCapturedFromDate,
  urlHasWkDateRange,
} from '../../../Mediator/Scrape/UrlDateRangeInspect.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { redactAccount } from '../../../Types/PiiRedactor.js';
import type { IDashboardTxnHarvest } from '../../../Types/PipelineContext.js';
import { EMPTY_TXN_HARVEST } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import {
  buildAccountResult,
  deduplicateTxns,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
} from '../ScrapeDataActions.js';
import {
  type IAccountAssemblyCtx,
  type IAccountFetchCtx,
  type IPostFetchCtx,
} from '../ScrapeTypes.js';

const LOG = createLogger('scrape-post');

/**
 * Returns true when `iterationAccountId` is compatible with the
 * accountId DASHBOARD captured. Banks expose two variants of the same
 * id — display form (`991234`) and the long bank/branch form
 * (`99-999-991234`). A bidirectional `endsWith` check normalizes
 * across both directions without bank-specific branches.
 *
 * @param capturedAccountId - AccountId DASHBOARD parsed from the URL.
 * @param iterationAccountId - AccountId SCRAPE iterates against.
 * @returns True when the two ids are compatible.
 */
function accountIdsCompatible(capturedAccountId: string, iterationAccountId: string): boolean {
  if (capturedAccountId === iterationAccountId) return true;
  if (capturedAccountId === '' || iterationAccountId === '') return false;
  return (
    capturedAccountId.endsWith(iterationAccountId) || iterationAccountId.endsWith(capturedAccountId)
  );
}

/**
 * Decide whether the DASHBOARD-side harvest is reusable for one
 * iteration's accountId. Returns true only when the harvest carries
 * records, is not multi-account scope, and the captured accountId
 * is compatible (or absent — single-account banks).
 *
 * @param harvest - DASHBOARD-side harvest snapshot.
 * @param iterationAccountId - AccountId currently iterating.
 * @returns True when harvest is reusable.
 */
function harvestApplies(harvest: IDashboardTxnHarvest, iterationAccountId: string): boolean {
  if (harvest.records.length === 0) return false;
  if (harvest.multiAccountScope) return false;
  if (harvest.capturedAccountId === false) return true;
  return accountIdsCompatible(harvest.capturedAccountId, iterationAccountId);
}

/**
 * True when the captured TXN endpoint URL has no WK date-range params,
 * or the captured fromDate is at-or-before the user's requested start.
 * Generic — relies only on WK aliases + the safe URL parser.
 *
 * <p>When false, the DASHBOARD-side harvest reflects only the SPA's
 * narrow dashboard window (e.g. Hapoalim's 1-month preview). Reusing
 * it would mask the bulk of the user's requested history. The caller
 * forces fall-through to the chunked re-fetch path instead.
 *
 * @param fc - Fetch context (carries `startDate` + `txnEndpoint`).
 * @param post - POST fetch params (carries the URL to inspect).
 * @returns True when harvest covers the requested range.
 */
function capturedWindowCoversRequested(fc: IAccountFetchCtx, post: IPostFetchCtx): boolean {
  const wkProbe = urlHasWkDateRange(post.url);
  if (!wkProbe.hasWkDateRange) return true;
  const capturedStart = readCapturedFromDate(post.url);
  if (capturedStart === false) return false;
  const requestedStartMs = parseStartDate(fc.startDate).getTime();
  return capturedStart.getTime() <= requestedStartMs;
}

/**
 * Build the {@link tryFirstWave} success Procedure from harvest records.
 * Extracted to keep the orchestrator under the 10-stmt cap and to mirror
 * the `scrapePostDirect` dedup/assembly seam.
 * @param fc - Fetch context.
 * @param post - POST fetch params (carries accountId + displayId).
 * @param records - Records pre-extracted by DASHBOARD.
 * @returns Procedure carrying the assembled account.
 */
function buildFirstWaveResult(
  fc: IAccountFetchCtx,
  post: IPostFetchCtx,
  records: readonly ITransaction[],
): Procedure<ITransactionsAccount> {
  // Phase F (2026-05-13): the DASHBOARD-side harvest carries the raw
  // records extracted from one or more pre-nav captures. The same
  // pending row can appear across capture boundaries on the
  // card-family banks; dedup here mirrors the matrix-loop guarantee.
  const startMs = parseStartDate(fc.startDate).getTime();
  const keyFields = fc.dedupKeyFields ?? FALLBACK_DEDUP_KEY_FIELDS;
  const unique = deduplicateTxns(records, startMs, keyFields);
  const assembly: IAccountAssemblyCtx = {
    fc,
    accountId: post.accountId,
    displayId: post.displayId,
  };
  return buildAccountResult(assembly, unique);
}

/**
 * Phase 7f follow-up: try the DASHBOARD-side harvest before issuing a
 * fresh per-account fetch. Recovers the per-account fast path that
 * pre-Phase-7f's `tryBufferedResponse` provided, but as a typed
 * value-pass instead of a network-surface back door — SCRAPE consumes
 * the pre-extracted `readonly ITransaction[]` DASHBOARD already saw.
 *
 * <p>Mirrors {@link tryMatrixLoop}'s contract: returns a Procedure on
 * success, `false` on miss so the caller can fall through to billing
 * / range / direct strategies.
 *
 * <p>v4 (2026-05-27): the `accountRecord` parameter is no longer
 * threaded into the assembly context — balance resolution moved out
 * of SCRAPE to the BALANCE-RESOLVE phase, which consumes
 * `scrape.perAccountResponses` instead.
 *
 * <p>2026-06-07 Hapoalim billing-cycle fix: when the captured TXN
 * endpoint URL carries WK date-range params (Hapoalim/Discount-style
 * windowed POST/GET) AND the captured window's fromDate is AFTER the
 * user's requested `startDate`, the harvest covers only the SPA's
 * narrow dashboard view — NOT the user's range — so the fast path
 * is skipped to force a fresh range-aware re-fetch downstream. See
 * {@link capturedWindowCoversRequested}.
 *
 * @param fc - Fetch context (carries the harvest from SCRAPE.PRE).
 * @param post - POST fetch params for the iteration's account.
 * @returns Procedure on hit, false on miss.
 */
async function tryFirstWave(
  fc: IAccountFetchCtx,
  post: IPostFetchCtx,
): Promise<Procedure<ITransactionsAccount> | false> {
  await Promise.resolve();
  const harvest = fc.dashboardTxnHarvest ?? EMPTY_TXN_HARVEST;
  if (!harvestApplies(harvest, post.accountId)) return false;
  if (!capturedWindowCoversRequested(fc, post)) return false;
  const accountLabel = redactAccount(post.accountId);
  const recordCount = String(harvest.records.length);
  LOG.debug({
    message: `tryFirstWave hit: account=${accountLabel} records=${recordCount}`,
  });
  return buildFirstWaveResult(fc, post, harvest.records);
}

export default tryFirstWave;
