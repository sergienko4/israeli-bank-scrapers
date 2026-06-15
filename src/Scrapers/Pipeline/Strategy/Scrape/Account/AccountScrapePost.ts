/**
 * AccountScrape POST strategies — date-range chunking, billing
 * fallback, direct single-request, and the POST fetch-context builder.
 * Extracted from AccountScrapeStrategy.ts during the Phase 12e
 * file-size drain so each concern stays under `max-lines:150`.
 */

import type { ITransactionsAccount } from '../../../../../Transactions.js';
import { parseFreshResponse } from '../../../Mediator/Dashboard/TxnParser.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { redactAccount } from '../../../Types/PiiRedactor.js';
import type { ITxnEndpoint } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import { tryBillingFallback } from '../BillingFallbackStrategy.js';
import {
  buildAccountResult,
  deduplicateTxns,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
  scrapeWithMonthlyChunking,
  templatePostBody,
} from '../ScrapeDataActions.js';
import {
  type ApiPayload,
  type IAccountAssemblyCtx,
  type IAccountFetchCtx,
  type IChunkingCtx,
  type IPostFetchCtx,
} from '../ScrapeTypes.js';
import { patchUrlRange, txnEpForParse } from './AccountScrapeShared.js';
import { extractCardId, extractIds } from './ScrapeIdExtraction.js';

const LOG = createLogger('scrape-post');
const CARD_SOURCE_LABELS: Record<string, string> = { true: 'from cards[]', false: 'from record' };

/**
 * POST with date range: chunks then billing fallback.
 * @param fc - Fetch context.
 * @param postCtx - POST fetch params.
 * @returns Account with transactions.
 */
async function scrapePostWithRange(
  fc: IAccountFetchCtx,
  postCtx: IPostFetchCtx,
): Promise<Procedure<ITransactionsAccount>> {
  const ctx: IChunkingCtx = { fc, ...postCtx };
  const rangeResult = await scrapeWithMonthlyChunking(ctx);
  const hasResults = isOk(rangeResult) && rangeResult.value.txns.length > 0;
  if (hasResults) return rangeResult;
  LOG.debug({
    message: 'range=0 txns, trying billing fallback',
  });
  return tryBillingFallback(fc, postCtx);
}

/**
 * POST without date range: direct single request.
 *
 * <p>v4 (2026-05-27): `rawRecord` parameter dropped. SCRAPE's account
 * assembly no longer resolves balance — that moved to the
 * BALANCE-RESOLVE phase. The captured response body is still
 * attributed to this accountId via SCRAPE.final's URL/postData
 * mention walk over `mediator.network.getAllEndpoints()`.
 *
 * @param fc - Fetch context.
 * @param postCtx - POST fetch params.
 * @returns Account with transactions.
 */
async function scrapePostDirect(
  fc: IAccountFetchCtx,
  postCtx: IPostFetchCtx,
): Promise<Procedure<ITransactionsAccount>> {
  const patchedUrl = patchUrlRange(postCtx.url, fc);
  const raw = await fc.api.fetchPost<Record<string, unknown>>(
    patchedUrl,
    postCtx.baseBody as Record<string, string | object>,
  );
  if (!isOk(raw)) return raw;
  const fieldMap = txnEpForParse(fc);
  const txns = parseFreshResponse(raw.value, fieldMap);
  // Phase F (2026-05-13): single-response bodies still ship the same
  // pending row in multiple txn-array sections (Isracard `approvals`
  // + `outOfStatementChargeDateVouchers`). Route every assembly path
  // through the dedup factory so consumers always receive a canonical
  // unique-by-identifier list.
  const startMs = parseStartDate(fc.startDate).getTime();
  const keyFields = fc.dedupKeyFields ?? FALLBACK_DEDUP_KEY_FIELDS;
  const unique = deduplicateTxns(txns, startMs, keyFields);
  const assembly: IAccountAssemblyCtx = {
    fc,
    accountId: postCtx.accountId,
    displayId: postCtx.displayId,
  };
  return buildAccountResult(assembly, unique);
}

/**
 * Build POST fetch context from account record + slim TXN endpoint.
 * Phase 7f: takes the typed `ITxnEndpoint`; reads `templatePostData`
 * (false for GET) and `url` directly. No `IDiscoveredEndpoint`.
 *
 * @param accountRecord - Account record from init.
 * @param txnEndpoint - Slim TXN endpoint committed by DASHBOARD.FINAL.
 * @returns POST context and captured-template body.
 */
function buildPostCtx(
  accountRecord: Record<string, unknown>,
  txnEndpoint: ITxnEndpoint,
): { readonly post: IPostFetchCtx; readonly capturedBody: ApiPayload } {
  const { displayId, accountId } = extractIds(accountRecord);
  const cardId = extractCardId(accountRecord) || accountId;
  const rawPost = ((): string => {
    if (txnEndpoint.templatePostData === false) return '{}';
    return txnEndpoint.templatePostData || '{}';
  })();
  const capturedBody = JSON.parse(rawPost) as ApiPayload;
  const baseBody = templatePostBody(rawPost, accountRecord, cardId);
  const isLookupCard = cardId !== accountId;
  const cardLabel = redactAccount(cardId);
  LOG.debug({
    message:
      `buildPostCtx: cardUniqueId=${cardLabel} ` +
      `source=${CARD_SOURCE_LABELS[String(isLookupCard)]}`,
  });
  const post: IPostFetchCtx = {
    baseBody,
    url: txnEndpoint.url,
    displayId: displayId || cardId,
    accountId: cardId,
  };
  return { post, capturedBody };
}

export { buildPostCtx, scrapePostDirect, scrapePostWithRange };
