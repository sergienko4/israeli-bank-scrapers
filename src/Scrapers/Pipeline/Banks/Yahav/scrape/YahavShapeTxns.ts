/**
 * Yahav BaNCS scrape shape — transactions step. Walks the scrape window
 * `[startDate, today]` MONTH BY MONTH (cursor = chunk index), POSTing one
 * CURRENT_ACCOUNT Payload (0033) per chunk to the multiplexed `/account`
 * endpoint. Reuses the shared `generateMonthChunks` (end capped at today) so a
 * wide range never depends on BaNCS honouring a single wide query — matching
 * the generic path's proven full-range replay (PR #405). Each page's rows are
 * hunted + signed + flattened to `bancs*` scalars for the per-row auto-mapper.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import normalizeBancsRecords from '../../../Mediator/Scrape/Bancs/BancsNormalizer.js';
import { bankDayOfInstant } from '../../../Mediator/Scrape/BankCalendar.js';
import huntTransactions from '../../../Mediator/Scrape/FieldHunt/TxnHunt.js';
import {
  generateMonthChunks,
  type IMonthChunk,
} from '../../../Mediator/Scrape/ScrapeReplay/MonthChunking.js';
import { scrapeWindowEnd } from '../../../Mediator/Scrape/ScrapeWindowEnd.js';
import type {
  IApiDirectScrapeTxnsStep,
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IWindowRequestPolicy } from '../../../Types/WindowNarrowing.js';
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
 * Build the one-day fallback from the bank calendar.
 * @param end - Effective scrape-window end.
 * @returns A chunk naming the end's bank day.
 */
function fallbackChunk(end: Date): IMonthChunk {
  const day = bankDayOfInstant(end);
  if (day === false) throw new RangeError('Yahav: invalid scrape window end');
  const stamp = `${day}T00:00:00.000Z`;
  return { start: stamp, end: stamp };
}

const PLAN_ERROR = 'Yahav: invalid or oversized month plan';

/**
 * Resolve Yahav's plan while preserving its intentional future-start fallback.
 * @param ctx - Action context carrying the requested window.
 * @returns Month chunks, or false for rejected generator input.
 */
function resolveScrapeChunks(ctx: IActionContext): readonly IMonthChunk[] | false {
  const start = new Date(ctx.options.startDate);
  const end = scrapeWindowEnd(ctx);
  if (start.getTime() > end.getTime()) return [fallbackChunk(end)];
  return generateMonthChunks(start, end);
}

/**
 * Month chunks spanning `[startDate, today]` — never empty (a degenerate
 * future startDate falls back to the effective end's bank day).
 *
 * <p>The bound is handed over as a raw instant: `generateMonthChunks` names
 * bank-calendar days itself, so re-anchoring it here would apply the bank's
 * zone twice.
 * @param ctx - Action context (carries startDate).
 * @returns Ordered month chunks.
 */
function scrapeChunks(ctx: IActionContext): readonly IMonthChunk[] {
  const chunks = resolveScrapeChunks(ctx);
  if (chunks !== false) return chunks;
  throw new RangeError(PLAN_ERROR);
}

/**
 * Reject an unsafe Yahav plan before request variables are built.
 * @param ctx - Action context carrying the requested window.
 * @returns Typed validation result.
 */
function validatePlan(ctx: IActionContext): Procedure<void> {
  if (resolveScrapeChunks(ctx) !== false) return succeed(undefined);
  return fail(ScraperErrorTypes.Generic, PLAN_ERROR);
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
export const YAHAV_TXNS: IApiDirectScrapeTxnsStep<IYahavAcct, number> & IWindowRequestPolicy = {
  buildVars: txnsVars,
  extractPage: txnsExtractPage,
  validatePlan,
  windowNarrowing: 'windowEnd',
  urlTag: txnsUrl,
  method: 'POST',
  extraHeaders: bancsHeaders,
};
