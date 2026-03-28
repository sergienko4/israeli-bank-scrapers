/**
 * Monthly scrape factory — generic monthly iteration pattern.
 * Banks provide getMonthTransactions(ctx, month), this factory handles iteration + merge.
 * Produces a CustomScrapeFn compatible with PipelineBuilder.withScraper().
 */

import type { Moment } from 'moment';
import moment from 'moment';

import type { ITransactionsAccount } from '../../../Transactions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import { some } from '../Types/Option.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, isOk, succeed } from '../Types/Procedure.js';
import getAllMonthMoments from './Dates.js';

/** Months to look back from the start date. */
type MonthsBack = number;
/** Milliseconds to wait between API calls. */
type RateLimitMs = number;
/** Whether an account was successfully merged into the accumulator. */
type MergeSuccess = boolean;

/** Configuration for monthly scrape — bank provides getMonthTransactions + optional setup. */
interface IMonthlyConfig {
  /** Default months back from startDate. */
  readonly defaultMonthsBack: MonthsBack;
  /** Rate limit delay between month fetches (ms). 0 for none. */
  readonly rateLimitMs: RateLimitMs;
  /** One-time setup before monthly iteration (e.g., load categories). */
  readonly setup?: (ctx: IPipelineContext) => Promise<Procedure<boolean>>;
  /** Fetch and map one month's data. Returns accounts for that month. */
  readonly getMonthTransactions: (
    ctx: IPipelineContext,
    month: Moment,
  ) => Promise<Procedure<readonly ITransactionsAccount[]>>;
}

/** Custom scrape function type — compatible with PipelineBuilder.withScraper(). */
type CustomScrapeFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/** Result from a single month fetch — soft fail with warnings. */
interface IMonthResult {
  readonly accounts: readonly ITransactionsAccount[];
  readonly warnings: readonly string[];
}

/** Empty month result — base case. */
const EMPTY_MONTH: IMonthResult = { accounts: [], warnings: [] };

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
  return getAllMonthMoments(start, futureMonths);
}

/**
 * Fetch one month with soft failure — returns warning instead of hard error.
 * @param config - Monthly config.
 * @param ctx - Pipeline context.
 * @param month - Month to fetch.
 * @returns Accounts for the month, or empty with warning on failure.
 */
async function fetchOneSafe(
  config: IMonthlyConfig,
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
 * Apply rate limit delay if configured. Uses page.waitForTimeout pattern.
 * @param delayMs - Delay in milliseconds (0 to skip).
 * @returns Resolved after delay.
 */
/**
 * Apply rate limit delay via browser page.waitForTimeout.
 * @param ctx - Pipeline context with browser page.
 * @param delayMs - Delay in milliseconds (0 to skip).
 * @returns True after delay.
 */
async function applyRateLimit(ctx: IPipelineContext, delayMs: number): Promise<boolean> {
  if (delayMs <= 0) return true;
  if (!ctx.browser.has) return true;
  await ctx.browser.value.page.waitForTimeout(delayMs);
  return true;
}

/** Bundled args for the recursive fetch loop. */
interface IFetchLoopArgs {
  readonly config: IMonthlyConfig;
  readonly ctx: IPipelineContext;
  readonly months: readonly Moment[];
}

/**
 * Fetch all months sequentially with rate limiting and soft failure.
 * @param args - Bundled fetch loop arguments.
 * @param index - Current index.
 * @returns Accumulated month results.
 */
async function fetchAllMonths(args: IFetchLoopArgs, index: number): Promise<IMonthResult> {
  if (index >= args.months.length) return EMPTY_MONTH;
  const monthResult = await fetchOneSafe(args.config, args.ctx, args.months[index]);
  await applyRateLimit(args.ctx, args.config.rateLimitMs);
  const rest = await fetchAllMonths(args, index + 1);
  const merged: IMonthResult = {
    accounts: [...monthResult.accounts, ...rest.accounts],
    warnings: [...monthResult.warnings, ...rest.warnings],
  };
  return merged;
}

/**
 * Add an account to the merge map — merges txns for same accountNumber.
 * @param map - Mutable map of accountNumber → merged account.
 * @param acct - Account to merge in.
 * @returns True after merging.
 */
function mergeOneAccount(
  map: Map<string, ITransactionsAccount>,
  acct: ITransactionsAccount,
): MergeSuccess {
  const existing = map.get(acct.accountNumber);
  if (!existing) {
    map.set(acct.accountNumber, { ...acct, txns: [...acct.txns] });
    return true;
  }
  const merged: ITransactionsAccount = {
    accountNumber: existing.accountNumber,
    balance: acct.balance,
    txns: [...existing.txns, ...acct.txns],
  };
  map.set(acct.accountNumber, merged);
  return true;
}

/**
 * Merge accounts with the same accountNumber across months.
 * @param allAccounts - Flat list of accounts from all months.
 * @returns Merged accounts — one per accountNumber with combined txns.
 */
function mergeAccounts(
  allAccounts: readonly ITransactionsAccount[],
): readonly ITransactionsAccount[] {
  const map = new Map<string, ITransactionsAccount>();
  for (const acct of allAccounts) mergeOneAccount(map, acct);
  return [...map.values()];
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
 * Execute the monthly scrape lifecycle: setup → iterate → merge → assemble context.
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
  const monthsResult = await fetchAllMonths(args, 0);
  const accounts = mergeAccounts(monthsResult.accounts);
  const prevWarnings = ctx.diagnostics.warnings;
  const allWarnings = [...prevWarnings, ...monthsResult.warnings];
  const diag = { ...ctx.diagnostics, warnings: allWarnings };
  return succeed({ ...ctx, diagnostics: diag, scrape: some({ accounts }) });
}

/**
 * Create a CustomScrapeFn from a monthly configuration.
 * The returned function handles: setup → month iteration → merge → context assembly.
 * @param config - Monthly scrape configuration.
 * @returns CustomScrapeFn for use with PipelineBuilder.withScraper().
 */
function createMonthlyScrapeFn(config: IMonthlyConfig): CustomScrapeFn {
  /**
   * Wrap caught error as Procedure failure.
   * @param error - Caught error.
   * @returns Failure procedure.
   */
  const wrapError = (error: Error): Procedure<IPipelineContext> => {
    const msg = toErrorMessage(error);
    return fail(ScraperErrorTypes.Generic, `Monthly scrape failed: ${msg}`);
  };
  return async (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
    return await executeMonthly(config, ctx).catch(wrapError);
  };
}

export type { CustomScrapeFn, IMonthlyConfig };
export { createMonthlyScrapeFn };
