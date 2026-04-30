/**
 * Monthly fetch loop — sequential scraping with rate limiting.
 * Extracted from MonthlyScrapeFactory.ts to respect max-lines.
 */

import type { Moment } from 'moment';

import type { ITransactionsAccount } from '../../../../../Transactions.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';

/** Delay between fetches in milliseconds. */
type RateLimitMs = number;

/** Configuration for monthly scrape. */
interface IMonthlyFetchConfig {
  /** Rate limit delay between month fetches (ms). */
  readonly rateLimitMs: RateLimitMs;
  /** Fetch and map one month's data. */
  readonly getMonthTransactions: (
    ctx: IPipelineContext,
    month: Moment,
  ) => Promise<Procedure<readonly ITransactionsAccount[]>>;
}

/** Result from a single month fetch — soft fail with warnings. */
interface IMonthResult {
  readonly accounts: readonly ITransactionsAccount[];
  readonly warnings: readonly string[];
}

/** Empty month result — base case. */
const EMPTY_MONTH: IMonthResult = { accounts: [], warnings: [] };

/**
 * Fetch one month with soft failure.
 * @param config - Monthly config.
 * @param ctx - Pipeline context.
 * @param month - Month to fetch.
 * @returns Accounts or empty with warning on failure.
 */
async function scrapeOneSafe(
  config: IMonthlyFetchConfig,
  ctx: IPipelineContext,
  month: Moment,
): Promise<IMonthResult> {
  const result = await config.getMonthTransactions(ctx, month);
  if (isOk(result)) return { accounts: result.value, warnings: [] };
  const label = month.format('YYYY-MM');
  const warning = `Month ${label}: ${result.errorMessage}`;
  return { accounts: [], warnings: [warning] };
}

/**
 * Apply rate limit delay via browser page.waitForTimeout.
 * @param ctx - Pipeline context with browser page.
 */
/** Delay in milliseconds. */
type DelayMs = number;

/**
 * Apply rate limit delay via browser page.waitForTimeout.
 * @param ctx - Pipeline context with browser page.
 * @param delayMs - Delay in milliseconds (0 to skip).
 * @returns Succeed after delay.
 */
async function applyRateLimit(ctx: IPipelineContext, delayMs: DelayMs): Promise<Procedure<void>> {
  if (delayMs <= 0) return succeed(undefined);
  if (!ctx.browser.has) return succeed(undefined);
  await ctx.browser.value.page.waitForTimeout(delayMs);
  return succeed(undefined);
}

/** Bundled args for the recursive fetch loop. */
interface IFetchLoopArgs {
  readonly config: IMonthlyFetchConfig;
  readonly ctx: IPipelineContext;
  readonly months: readonly Moment[];
}

/** Zero-based array position in the month list. */
type MonthIdx = number;

/**
 * Fetch all months sequentially with rate limiting.
 * @param args - Bundled fetch loop arguments.
 * @param index - Current index.
 * @returns Accumulated month results.
 */
async function scrapeAllMonths(args: IFetchLoopArgs, index: MonthIdx): Promise<IMonthResult> {
  if (index >= args.months.length) return EMPTY_MONTH;
  const monthResult = await scrapeOneSafe(args.config, args.ctx, args.months[index]);
  await applyRateLimit(args.ctx, args.config.rateLimitMs);
  const rest = await scrapeAllMonths(args, index + 1);
  return {
    accounts: [...monthResult.accounts, ...rest.accounts],
    warnings: [...monthResult.warnings, ...rest.warnings],
  };
}

export type { IFetchLoopArgs, IMonthlyFetchConfig, IMonthResult };
export { EMPTY_MONTH, scrapeAllMonths };
