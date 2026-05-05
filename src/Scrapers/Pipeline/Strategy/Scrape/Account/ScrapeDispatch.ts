/**
 * Account dispatch + iteration — routes each account to POST or GET strategy.
 * Billing in ScrapeBillingHelpers.ts, strategies in ScrapePostHelpers.ts.
 */

import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import type { ITransactionsAccount } from '../../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IDiscoveredEndpoint } from '../../../Mediator/Network/NetworkDiscovery.js';
import { getDebug } from '../../../Types/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk } from '../../../Types/Procedure.js';
import type {
  ApiPayload,
  IAccountFetchCtx,
  IAccountFetchOpts,
  IFetchAllAccountsCtx,
} from '../ScrapeTypes.js';
import { scrapeOneAccountPost, scrapeOneAccountViaUrl } from './AccountScrapeStrategy.js';

const LOG = getDebug(import.meta.url);

/**
 * Per-account wall-clock budget. Any bank whose single-account scrape
 * exceeds this duration is treated as hung — the Procedure fails with
 * a Timeout code so the sequential chain can proceed to the next
 * account instead of blocking the test-level budget indefinitely.
 *
 * 300_000 ms = 5 minutes accommodates slow card-family accounts
 * (Discount ~200s, Isracard/VisaCal ~150s) while still catching
 * pathological hangs well before SCRAPE_TIMEOUT (900s) kicks in.
 */
const PER_ACCOUNT_TIMEOUT_MS = 300_000;

/**
 * Global scrape wall-clock budget. Once this elapses, scrapeAllAccounts
 * stops iterating and returns whatever has been collected so far.
 * Defensive ceiling for banks that expose many cards where several
 * hang consecutively — without this, N_hanging × PER_ACCOUNT_TIMEOUT_MS
 * could still exceed the test budget even though each account
 * individually timed out.
 *
 * 600_000 ms = 10 minutes leaves headroom inside the 900_000 ms test
 * budget (SCRAPE_TIMEOUT) after login + dashboard overhead (~4 minutes
 * for slow SPA banks like MAX / cal-online stack).
 */
const GLOBAL_SCRAPE_BUDGET_MS = 600_000;

export { tryBufferedResponse } from './AccountScrapeStrategy.js';

/** Account index in sequential iteration. */
type AccountIndex = number;

/**
 * Check if options indicate a POST endpoint is available.
 * @param opts - Account fetch options.
 * @returns True if POST endpoint with account record exists.
 */
function hasPostEndpoint(opts: IAccountFetchOpts): opts is IAccountFetchOpts & {
  readonly accountRecord: ApiPayload;
  readonly txnEndpoint: IDiscoveredEndpoint;
} {
  if (!opts.txnEndpoint) return false;
  if (opts.txnEndpoint.method !== 'POST') return false;
  return Boolean(opts.accountRecord);
}

/**
 * Dispatch one account to the appropriate strategy.
 * @param fc - Fetch context.
 * @param accountId - Account number.
 * @param opts - Account record and endpoint.
 * @returns Account with transactions.
 */
async function dispatchOneAccount(
  fc: IAccountFetchCtx,
  accountId: string,
  opts: IAccountFetchOpts,
): Promise<Procedure<ITransactionsAccount>> {
  if (!hasPostEndpoint(opts)) return scrapeOneAccountViaUrl(fc, accountId);
  return scrapeOneAccountPost(fc, opts.accountRecord, opts.txnEndpoint);
}

/** Sentinel returned by the timeout arm of the Promise.race. */
interface IBudgetSentinel {
  readonly exceeded: true;
}

const BUDGET_SENTINEL: IBudgetSentinel = { exceeded: true };

/**
 * Build a Promise that resolves to a budget-sentinel after `ms` elapses.
 * The resolved value signals that the per-account wall-clock budget was
 * exceeded; the caller translates it into a typed Procedure.fail.
 * @param ms - Budget in milliseconds.
 * @returns Budget-sentinel Promise.
 */
async function budgetElapsed(ms: number): Promise<IBudgetSentinel> {
  await setTimeoutPromise(ms, undefined, { ref: false });
  return BUDGET_SENTINEL;
}

/** Bundled args for dispatchWithTimeout — respects the 3-param ceiling. */
interface IDispatchArgs {
  readonly fc: IAccountFetchCtx;
  readonly accountId: string;
  readonly opts: IAccountFetchOpts;
  /**
   * Optional wall-clock override. When unset, defaults to
   * PER_ACCOUNT_TIMEOUT_MS. Tests pass a small override to
   * deterministically exercise the timeout branch.
   */
  readonly timeoutMs?: number;
}

/**
 * Race a dispatch call against the per-account wall-clock budget. If
 * the dispatch fails to settle within the budget, a typed Timeout
 * Procedure is returned so the outer chain can continue.
 * @param args - Bundled dispatch arguments.
 * @returns The earlier of the dispatch result or the timeout fail.
 */
async function dispatchWithTimeout(args: IDispatchArgs): Promise<Procedure<ITransactionsAccount>> {
  const budgetMs = args.timeoutMs ?? PER_ACCOUNT_TIMEOUT_MS;
  const work = dispatchOneAccount(args.fc, args.accountId, args.opts);
  const budget = budgetElapsed(budgetMs);
  const racers: readonly (Promise<Procedure<ITransactionsAccount>> | Promise<IBudgetSentinel>)[] = [
    work,
    budget,
  ];
  const settled = await Promise.race(racers);
  if (settled === BUDGET_SENTINEL) {
    const budgetSeconds = Math.round(budgetMs / 1000);
    const budgetSec = String(budgetSeconds);
    return fail(
      ScraperErrorTypes.Timeout,
      `scrape dispatch: per-account ${budgetSec}s budget exceeded`,
    );
  }
  return settled as Procedure<ITransactionsAccount>;
}

/**
 * Process one account (loop body helper).
 * @param ctx - Fetch-all context.
 * @param index - Current account index.
 * @param out - Accumulator.
 * @returns True when processed.
 */
async function processOneAccount(
  ctx: IFetchAllAccountsCtx,
  index: number,
  out: ITransactionsAccount[],
): Promise<true> {
  const opts: IAccountFetchOpts = {
    accountRecord: ctx.records[index],
    txnEndpoint: ctx.txnEndpoint,
  };
  const accountId = ctx.ids[index];
  const result = await dispatchWithTimeout({ fc: ctx.fc, accountId, opts });
  if (isOk(result)) {
    out.push(result.value);
    return true as const;
  }
  LOG.warn({
    accountIndex: String(index),
    message: `scrape skipped — ${result.errorMessage}`,
  });
  return true as const;
}

/**
 * Build index array for sequential account iteration.
 * @param count - Number of accounts.
 * @returns Array of indices [0, 1, 2, ...].
 */
function indexArray(count: number): readonly AccountIndex[] {
  return Array.from({ length: count }, (_, i): AccountIndex => i);
}

/** Bundled args for processOrSkip — respects the 3-param ceiling. */
interface IProcessOrSkipArgs {
  readonly ctx: IFetchAllAccountsCtx;
  readonly idx: number;
  readonly out: ITransactionsAccount[];
  readonly deadline: number;
}

/**
 * Process one account or short-circuit when the global scrape budget
 * has already been exceeded.
 * @param args - Bundled loop-step arguments.
 * @returns True once the step is done (always resolves).
 */
async function processOrSkip(args: IProcessOrSkipArgs): Promise<true> {
  if (Date.now() >= args.deadline) {
    LOG.warn({
      accountIndex: String(args.idx),
      message: 'scrape skipped — global scrape budget exceeded',
    });
    return true as const;
  }
  return processOneAccount(args.ctx, args.idx, args.out);
}

/**
 * Scrape all accounts via sequential promise chain. A wall-clock
 * deadline (GLOBAL_SCRAPE_BUDGET_MS) stops iteration early so the
 * outer test budget is never exceeded even when many accounts hang.
 * @param ctx - Bundled fetch-all context.
 * @returns Scraped accounts array.
 */
async function scrapeAllAccounts(
  ctx: IFetchAllAccountsCtx,
): Promise<readonly ITransactionsAccount[]> {
  const accounts: ITransactionsAccount[] = [];
  const indices = indexArray(ctx.ids.length);
  const deadline = Date.now() + GLOBAL_SCRAPE_BUDGET_MS;
  const seed = Promise.resolve(true as const);
  await indices.reduce(
    (prev, idx): Promise<true> =>
      prev.then((): Promise<true> => processOrSkip({ ctx, idx, out: accounts, deadline })),
    seed,
  );
  return accounts;
}

export default scrapeAllAccounts;
// Internal exports for focused unit tests. DO NOT import outside
// src/Tests/Unit/**. Safe to change without deprecation.
export {
  BUDGET_SENTINEL as __BUDGET_SENTINEL,
  budgetElapsed as __budgetElapsed,
  dispatchWithTimeout as __dispatchWithTimeout,
  GLOBAL_SCRAPE_BUDGET_MS as __GLOBAL_SCRAPE_BUDGET_MS,
  PER_ACCOUNT_TIMEOUT_MS as __PER_ACCOUNT_TIMEOUT_MS,
  processOrSkip as __processOrSkip,
  scrapeAllAccounts,
};
