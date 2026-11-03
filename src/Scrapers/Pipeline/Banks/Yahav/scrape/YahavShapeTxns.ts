/**
 * Yahav native scrape shape — the transactions read. Walks the
 * month plan one chunk per request, posting the CURRENT_ACCOUNT inquiry for
 * the account and window to the multiplexed account route. A page keeps only
 * the transaction rows that name the account; a row naming another
 * account is left unread, which the coverage audit reports as a shortfall.
 * Kept rows are signed and flattened to `bancs*` scalars for the mapper.
 */

import type { ApiRecord } from '../../../Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import normalizeBancsRecords from '../../../Mediator/Scrape/Bancs/BancsNormalizer.js';
import type {
  IApiDirectScrapeTxnsStep,
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { YAHAV_BANCS_PATHS as PATHS } from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { isYahavAccountOf, yahavEntities } from './YahavAccountExtract.js';
import { yahavTxnsPayload } from './YahavNativePayloadsAccount.js';
import { YAHAV_ACCOUNT_HEADERS, YAHAV_ACCOUNT_URL } from './YahavShapeAccounts.js';
import { yahavReadVars } from './YahavShapeCall.js';
import { chunkAt, scrapeChunks, validatePlan, yahavDayOf } from './YahavShapeChunks.js';
import { type IYahavAcct, yahavPortfolioOf } from './YahavShapeHelpers.js';

/**
 * The transactions read body for one account and one month chunk.
 * @param acct - The account.
 * @param cursor - Chunk index, or false on the first call.
 * @param ctx - Action context carrying the window.
 * @returns Read body.
 */
function txnsVars(acct: IYahavAcct, cursor: number | false, ctx: IActionContext): VarsMap {
  const chunks = scrapeChunks(ctx);
  const chunk = chunkAt(chunks, cursor);
  const from = yahavDayOf(chunk.start);
  const to = yahavDayOf(chunk.end);
  const portfolio = yahavPortfolioOf(ctx);
  const payload = yahavTxnsPayload({ portfolio, account: acct, from, to });
  return yahavReadVars(ctx, PATHS.account, payload);
}

/**
 * Whether an entity is a transaction of the account.
 * @param row - Answer entity.
 * @param acct - The account.
 * @returns True for the account's transaction rows.
 */
function isAccountTxn(row: ApiRecord, acct: IYahavAcct): boolean {
  return row.Ver === 'Transaction_1.0.0' && isYahavAccountOf(row.AccountId, acct);
}

/**
 * The cursor after this chunk, false after the last.
 * @param ctx - Action context carrying the window.
 * @param cursor - Chunk index, or false on the first call.
 * @returns Next chunk index, or false.
 */
function nextChunk(ctx: IActionContext, cursor: number | false): number | false {
  const chunks = scrapeChunks(ctx);
  const next = (cursor === false ? 0 : cursor) + 1;
  return next < chunks.length ? next : false;
}

/**
 * One chunk's page: the account's transaction rows, BaNCS-normalized.
 * @param args - Answer, cursor, account and context.
 * @returns Page rows and the next chunk cursor.
 */
function txnsExtractPage(args: IExtractPageArgs<IYahavAcct, number>): IPage<object, number> {
  const entities = yahavEntities(args.body);
  const rows = entities.filter(row => isAccountTxn(row, args.acct));
  const items = normalizeBancsRecords(rows);
  const nextCursor = nextChunk(args.ctx, args.cursor);
  return { items, nextCursor };
}

/** Transactions read: month-chunked CURRENT_ACCOUNT inquiries. */
const YAHAV_TXNS: IApiDirectScrapeTxnsStep<IYahavAcct, number> = {
  buildVars: txnsVars,
  extractPage: txnsExtractPage,
  validatePlan,
  windowNarrowing: 'windowEnd',
  urlTag: YAHAV_ACCOUNT_URL,
  method: 'POST',
  extraHeaders: YAHAV_ACCOUNT_HEADERS,
};

export default YAHAV_TXNS;
export { YAHAV_TXNS };
