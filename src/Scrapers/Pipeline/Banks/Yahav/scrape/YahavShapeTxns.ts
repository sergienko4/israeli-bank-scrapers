/**
 * Yahav BaNCS scrape shape — transactions step. Walks the scrape window
 * `[startDate, today]` MONTH BY MONTH (cursor = chunk index), POSTing one
 * CURRENT_ACCOUNT Payload (0033) per chunk to the multiplexed `/account`
 * endpoint. Reuses the shared `generateMonthChunks` (end capped at today) so a
 * wide range never depends on BaNCS honouring a single wide query — matching
 * the generic path's proven full-range replay (PR #405). Each page's rows are
 * hunted + signed + flattened to `bancs*` scalars for the per-row auto-mapper.
 */

import normalizeBancsRecords from '../../../Mediator/Scrape/Bancs/BancsNormalizer.js';
import huntTransactions from '../../../Mediator/Scrape/FieldHunt/TxnHunt.js';
import {
  generateMonthChunks,
  type IMonthChunk,
} from '../../../Mediator/Scrape/ScrapeReplay/MonthChunking.js';
import type {
  IApiDirectScrapeTxnsStep,
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { buildEnvelope } from './YahavShapeEnvelope.js';
import { bancsHeaders } from './YahavShapeHeaders.js';
import { ACCOUNT_PATH, type IYahavAcct, YAHAV_API } from './YahavShapeHelpers.js';
import { txnsPayload } from './YahavShapeTxnPayload.js';

/**
 * The fixed multiplexed `/account` endpoint URL.
 * @returns Literal account URL.
 */
export function txnsUrl(): WKUrlOrLiteral {
  return literalUrl(`${YAHAV_API}${ACCOUNT_PATH}`);
}

/**
 * Month chunks spanning `[startDate, today]` — never empty (a degenerate
 * future startDate falls back to a single today chunk).
 * @param ctx - Action context (carries startDate).
 * @returns Ordered month chunks.
 */
function scrapeChunks(ctx: IActionContext): readonly IMonthChunk[] {
  const start = new Date(ctx.options.startDate);
  const end = new Date();
  const chunks = generateMonthChunks(start, end);
  return chunks.length > 0 ? chunks : [{ start: end.toISOString(), end: end.toISOString() }];
}

/**
 * The chunk at a cursor index (first chunk when the cursor is unset).
 * @param chunks - Ordered month chunks.
 * @param cursor - Chunk index, or false on the first call.
 * @returns The selected chunk.
 */
function chunkAt(chunks: readonly IMonthChunk[], cursor: number | false): IMonthChunk {
  const idx = cursor === false ? 0 : cursor;
  const safe = Math.min(idx, chunks.length - 1);
  return chunks[safe];
}

/**
 * Transactions request body — one month chunk's txns Payload in the envelope.
 * @param acct - Resolved Yahav account.
 * @param cursor - Chunk index, or false on the first call.
 * @param ctx - Action context (carries startDate + portfolio refs).
 * @returns Variables map POSTed as the JSON body.
 */
export function txnsVars(acct: IYahavAcct, cursor: number | false, ctx: IActionContext): VarsMap {
  const chunks = scrapeChunks(ctx);
  const chunk = chunkAt(chunks, cursor);
  const payload = txnsPayload(acct, chunk, ctx);
  return buildEnvelope(ctx, payload);
}

/**
 * Extract one chunk's transactions page — hunt the BaNCS `Transaction` rows,
 * sign + flatten them to `bancs*` scalars, and advance to the next chunk.
 * @param args - Bundle carrying the response body + chunk cursor.
 * @returns Page rows + the next chunk cursor (false when the last chunk done).
 */
export function txnsExtractPage(args: IExtractPageArgs<IYahavAcct, number>): IPage<object, number> {
  const chunks = scrapeChunks(args.ctx);
  const idx = args.cursor === false ? 0 : args.cursor;
  const nextCursor = idx + 1 < chunks.length ? idx + 1 : false;
  const hunted = huntTransactions(args.body);
  const items = normalizeBancsRecords(hunted);
  return { items, nextCursor };
}

/** Transactions step — month-chunked CURRENT_ACCOUNT POSTs, BaNCS-normalized. */
export const YAHAV_TXNS: IApiDirectScrapeTxnsStep<IYahavAcct, number> = {
  buildVars: txnsVars,
  extractPage: txnsExtractPage,
  urlTag: txnsUrl,
  method: 'POST',
  extraHeaders: bancsHeaders,
};
