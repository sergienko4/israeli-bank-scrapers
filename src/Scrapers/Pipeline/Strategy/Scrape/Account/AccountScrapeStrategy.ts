/**
 * Per-account scrape orchestrators. The two public entry points —
 * {@link scrapeOneAccountPost} (POST/body strategy) and
 * {@link scrapeOneAccountViaUrl} (GET/URL strategy) — sequence the
 * sub-strategies that were drained into co-located siblings during the
 * Phase 12e file-size split:
 *
 * - {@link ./AccountScrapeShared.ts | AccountScrapeShared} — URL/field
 *   leaf helpers (`patchUrlRange`, `txnEpForParse`).
 * - {@link ./AccountScrapePost.ts | AccountScrapePost} — POST context
 *   build + range/direct fetch (`buildPostCtx`, `scrapePostWithRange`,
 *   `scrapePostDirect`).
 * - {@link ./AccountScrapeFirstWave.ts | AccountScrapeFirstWave} — the
 *   DASHBOARD-harvest fast path (`tryFirstWave`).
 *
 * The public surface (`scrapeOneAccountPost`, `scrapeOneAccountViaUrl`)
 * is unchanged — consumers import it from this module verbatim.
 */

import type { ITransactionsAccount } from '../../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { parseFreshResponse } from '../../../Mediator/Dashboard/TxnParser.js';
import { isRangeIterable } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonRecord } from '../../../Mediator/Scrape/ScrapeReplayAction.js';
import { urlHasWkDateRange } from '../../../Mediator/Scrape/UrlDateRangeInspect.js';
import { fail, isOk, type Procedure } from '../../../Types/Procedure.js';
import { tryBillingFallback } from '../BillingFallbackStrategy.js';
import { tryMatrixLoop } from '../MatrixLoopStrategy.js';
import {
  buildAccountResult,
  deduplicateTxns,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
  resolveTxnUrl,
} from '../ScrapeDataActions.js';
import { EMPTY_TXN_ENDPOINT, type IAccountFetchCtx } from '../ScrapeTypes.js';
import tryFirstWave from './AccountScrapeFirstWave.js';
import { buildPostCtx, scrapePostDirect, scrapePostWithRange } from './AccountScrapePost.js';
import { patchUrlRange, txnEpForParse } from './AccountScrapeShared.js';
import { isFilterDataUrl, scrapeViaFilterData } from './FilterDataStrategy.js';

/**
 * POST strategy: matrix → first-wave harvest → billing → range → direct.
 *
 * <p>Sequences the per-account sub-strategies in priority order. The
 * matrix loop and DASHBOARD-side first-wave harvest are the fast paths
 * (no fresh fetch); billing fallback recovers card-family windows; the
 * range vs direct split handles windowed (WK date-range) endpoints vs
 * single-shot fetches. Each helper returns `false` on miss so this
 * orchestrator can fall through to the next strategy without
 * bank-specific branches.
 *
 * @param fc - Fetch context (api, network, harvest, dedup config).
 * @param accountRecord - Raw per-account record DASHBOARD captured.
 * @returns Procedure carrying the assembled account.
 */
async function scrapeOneAccountPost(
  fc: IAccountFetchCtx,
  accountRecord: Record<string, unknown>,
): Promise<Procedure<ITransactionsAccount>> {
  const txnEp = fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT;
  const { post, capturedBody } = buildPostCtx(accountRecord, txnEp);
  const matrix = await tryMatrixLoop({
    fc,
    accountId: post.accountId,
    displayId: post.displayId,
    accountRecord,
  });
  if (matrix !== false) return matrix;
  const firstWave = await tryFirstWave(fc, post);
  if (firstWave !== false) return firstWave;
  const billing = await tryBillingFallback(fc, post);
  if (isOk(billing) && billing.value.txns.length > 0) return billing;
  const isBodyIterable = isRangeIterable(capturedBody as JsonRecord);
  const isUrlIterable = urlHasWkDateRange(post.url).hasWkDateRange;
  if (isBodyIterable || isUrlIterable) return scrapePostWithRange(fc, post);
  return scrapePostDirect(fc, post);
}

/**
 * GET strategy: resolve a per-account TXN URL, patch its date range,
 * fetch, parse, dedup, and assemble. Used by banks that expose a
 * GET-style transaction endpoint (vs the POST/body path above).
 *
 * <p>Falls back to FilterData scraping when the captured URL is a
 * FilterData endpoint, and to an empty result when no URL was captured.
 *
 * @param fc - Fetch context (api, network, dedup config).
 * @param accountId - AccountId currently iterating.
 * @returns Procedure carrying the assembled account.
 */
async function scrapeOneAccountViaUrl(
  fc: IAccountFetchCtx,
  accountId: string,
): Promise<Procedure<ITransactionsAccount>> {
  const txnEp = fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT;
  if (txnEp.url === '') {
    return buildAccountResult({ fc, accountId, displayId: accountId }, []);
  }
  if (isFilterDataUrl(txnEp.url)) {
    return scrapeViaFilterData(fc, accountId, txnEp.url);
  }
  const urlCtx = { api: fc.api, network: fc.network, accountId, startDate: fc.startDate };
  const scrapeUrl = resolveTxnUrl(urlCtx);
  if (!scrapeUrl) return fail(ScraperErrorTypes.Generic, 'No txn URL');
  const patchedUrl = patchUrlRange(scrapeUrl, fc);
  const raw = await fc.api.fetchGet<Record<string, unknown>>(patchedUrl);
  if (!isOk(raw)) return raw;
  const fieldMap = txnEpForParse(fc);
  const txns = parseFreshResponse(raw.value, fieldMap);
  const startMs = parseStartDate(fc.startDate).getTime();
  const keyFields = fc.dedupKeyFields ?? FALLBACK_DEDUP_KEY_FIELDS;
  const unique = deduplicateTxns(txns, startMs, keyFields);
  return buildAccountResult({ fc, accountId, displayId: accountId }, unique);
}

export { scrapeOneAccountPost, scrapeOneAccountViaUrl };
