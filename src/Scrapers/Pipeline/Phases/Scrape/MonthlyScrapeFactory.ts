/**
 * Monthly scrape factory — generic monthly iteration pattern.
 * Banks provide getMonthTransactions(ctx, month), factory handles iteration + merge.
 * Fetch loop in MonthlyFetchLoop.ts. Merge logic in MonthlyMerge.ts.
 */

import type { Moment } from 'moment';
import moment from 'moment';

import type { ITransactionsAccount } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import buildMonthMoments from '../../Strategy/Scrape/Dates.js';
import type { IFetchLoopArgs } from '../../Strategy/Scrape/MonthlyFetchLoop.js';
import { scrapeAllMonths } from '../../Strategy/Scrape/MonthlyFetchLoop.js';
import { mergeAccounts } from '../../Strategy/Scrape/MonthlyMerge.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

/** Custom scrape function type. */
type CustomScrapeFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/** Count of months to look back from today. */
type MonthsBack = number;
/** Delay between fetches in milliseconds. */
type RateLimitMs = number;

/** Full monthly config with setup, month range, rate limiting. */
interface IMonthlyConfig {
  /** Default months back from startDate. */
  readonly defaultMonthsBack: MonthsBack;
  /** Rate limit delay between month fetches (ms). */
  readonly rateLimitMs: RateLimitMs;
  /** One-time setup before monthly iteration. */
  readonly setup?: (ctx: IPipelineContext) => Promise<Procedure<boolean>>;
  /** Fetch and map one month's data. */
  readonly getMonthTransactions: (
    ctx: IPipelineContext,
    month: Moment,
  ) => Promise<Procedure<readonly ITransactionsAccount[]>>;
}

/**
 * Build the month range from context options.
 * @param ctx - Pipeline context with startDate.
 * @param defaultMonthsBack - Fallback months back.
 * @returns Array of month moments.
 */
function buildMonthRange(ctx: IPipelineContext, defaultMonthsBack: number): Moment[] {
  const defaultStart = moment().subtract(defaultMonthsBack, 'months');
  const optionsStart = moment(ctx.options.startDate);
  const start = moment.max(defaultStart, optionsStart);
  const futureMonths = ctx.options.futureMonthsToScrape ?? 0;
  return buildMonthMoments(start, futureMonths);
}

/**
 * Run the optional setup function.
 * @param config - Monthly config.
 * @param ctx - Pipeline context.
 * @returns Success or failure from setup.
 */
async function runSetup(
  config: IMonthlyConfig,
  ctx: IPipelineContext,
): Promise<Procedure<boolean>> {
  if (!config.setup) return succeed(true);
  return config.setup(ctx);
}

/**
 * Execute the monthly scrape lifecycle.
 * @param config - Monthly scrape configuration.
 * @param ctx - Pipeline context.
 * @returns Updated context with scrape.accounts populated.
 */
async function executeMonthly(
  config: IMonthlyConfig,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const setupResult = await runSetup(config, ctx);
  if (!isOk(setupResult)) return setupResult;
  const months = buildMonthRange(ctx, config.defaultMonthsBack);
  const args: IFetchLoopArgs = { config, ctx, months };
  const monthsResult = await scrapeAllMonths(args, 0);
  const accounts = mergeAccounts(monthsResult.accounts);
  const prevWarnings = ctx.diagnostics.warnings;
  const allWarnings = [...prevWarnings, ...monthsResult.warnings];
  const diag = { ...ctx.diagnostics, warnings: allWarnings };
  return succeed({ ...ctx, diagnostics: diag, scrape: some({ accounts }) });
}

/**
 * Wrap caught error as Procedure failure.
 * @param error - Caught error.
 * @returns Failure procedure.
 */
function wrapMonthlyError(error: Error): Procedure<IPipelineContext> {
  const msg = toErrorMessage(error);
  return fail(ScraperErrorTypes.Generic, `Monthly scrape failed: ${msg}`);
}

/**
 * Create a CustomScrapeFn from a monthly configuration.
 * @param config - Monthly scrape configuration.
 * @returns CustomScrapeFn for use with PipelineBuilder.withScraper().
 */
function createMonthlyScrapeFn(config: IMonthlyConfig): CustomScrapeFn {
  return async (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
    try {
      return await executeMonthly(config, ctx);
    } catch (err) {
      return wrapMonthlyError(err as Error);
    }
  };
}

export type { CustomScrapeFn, IMonthlyConfig };
export { createMonthlyScrapeFn };
