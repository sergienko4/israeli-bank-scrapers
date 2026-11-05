/**
 * Yahav month plan: the scrape window `[startDate, window end]` walked month
 * by month (cursor = chunk index), through the shared `generateMonthChunks`,
 * so a wide range never depends on BaNCS honouring one wide query. A future
 * start falls back to the window end's bank day; an oversized range is
 * refused before any request is built.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { bankDayOfInstant } from '../../../Mediator/Scrape/BankCalendar.js';
import {
  generateMonthChunks,
  type IMonthChunk,
} from '../../../Mediator/Scrape/ScrapeReplay/MonthChunking.js';
import { scrapeWindowEnd } from '../../../Mediator/Scrape/ScrapeWindowEnd.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { fail, type Procedure, succeed } from '../../../Types/Procedure.js';
import type { IYahavNativeDay } from './YahavNativePayloadsAccount.js';

/** Why a plan is refused. */
const PLAN_ERROR = 'Yahav: invalid or oversized month plan';

/**
 * The one-day fallback on the window end's bank day.
 * @param end - Effective scrape-window end.
 * @returns A chunk naming that day.
 */
function fallbackChunk(end: Date): IMonthChunk {
  const day = bankDayOfInstant(end);
  if (day === false) throw new RangeError('Yahav: invalid scrape window end');
  const stamp = `${day}T00:00:00.000Z`;
  return { start: stamp, end: stamp };
}

/**
 * The month plan, keeping the future-start fallback.
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
 * The month plan; never empty.
 *
 * <p>The bound is handed over as a raw instant: `generateMonthChunks` names
 * bank-calendar days itself, so re-anchoring it here would apply the bank's
 * zone twice.
 * @param ctx - Action context carrying the requested window.
 * @returns Ordered month chunks.
 */
function scrapeChunks(ctx: IActionContext): readonly IMonthChunk[] {
  const chunks = resolveScrapeChunks(ctx);
  if (chunks !== false) return chunks;
  throw new RangeError(PLAN_ERROR);
}

/**
 * Refuse an unsafe plan before request variables are built.
 * @param ctx - Action context carrying the requested window.
 * @returns Typed validation result.
 */
function validatePlan(ctx: IActionContext): Procedure<void> {
  if (resolveScrapeChunks(ctx) !== false) return succeed(undefined);
  return fail(ScraperErrorTypes.Generic, PLAN_ERROR);
}

/**
 * The chunk at a cursor (the first when the cursor is unset).
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
 * The calendar day an ISO chunk bound names.
 * @param iso - ISO chunk bound.
 * @returns The day.
 */
function yahavDayOf(iso: string): IYahavNativeDay {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return { year: Number(year), month: Number(month), day: Number(day) };
}

export { chunkAt, scrapeChunks, validatePlan, yahavDayOf };
