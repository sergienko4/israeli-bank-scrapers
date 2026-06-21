/**
 * ApiDirectScrape phase actions — Zero-Logic Bank Folder pattern.
 * Banks supply an IApiDirectScrapeShape (data only); this file walks
 * customer → per-account (balance + paginated transactions), maps
 * rows via autoMapTransaction, and returns the scrape procedure.
 * Per-step helpers live in ApiDirectScrapeSteps.ts to keep this
 * file under the per-file LOC ceiling. Zero bank-name coupling.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { resolveApiMediator } from '../../Mediator/Api/ApiMediatorAccessor.js';
import { autoMapTransaction } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { fetchPaginated } from '../../Strategy/Fetch/Pagination.js';
import { some } from '../../Types/Option.js';
import type { IActionContext, IScrapeState } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import {
  buildPageFetcher,
  buildStop,
  fetchAccounts,
  fetchBalance,
  type IAcctCtx,
  type IDriverCtx,
} from './ApiDirectScrapeSteps.js';
import type { ApiDirectScrapeResult } from './ApiDirectScrapeTypes.js';
import type { IApiDirectScrapeShape } from './IApiDirectScrapeShape.js';

/** Per-account scrape outcome — assembled record + balance-degraded flag. */
interface IAccountResult {
  readonly account: ITransactionsAccount;
  readonly degraded: boolean;
}

/** Accumulator for per-account scrape results. */
type AcctsAcc = Procedure<readonly IAccountResult[]>;

/**
 * Map raw rows through autoMapTransaction (drops rejects).
 * @param raws - Raw rows emitted by the shape's extractPage.
 * @returns Mapped ITransactions (rejects filtered out).
 */
function mapTxns(raws: readonly object[]): readonly ITransaction[] {
  const widened = raws as unknown as readonly Record<string, unknown>[];
  const mapped = widened.map(autoMapTransaction);
  return mapped.filter((t): t is ITransaction => t !== false);
}

/**
 * Assemble one account — balance + paginated txns + mapping.
 * @param a - Per-account context.
 * @returns ITransactionsAccount procedure.
 */
async function fetchOneAccount<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IAccountResult>> {
  const bal = await fetchBalance(a);
  if (!isOk(bal)) return bal;
  const fetchPage = buildPageFetcher(a);
  const stop = buildStop(a);
  const paged = await fetchPaginated<object, TCursor>({ fetchPage, stop });
  if (!isOk(paged)) return paged;
  const accountNumber = a.shape.accountNumberOf(a.acct);
  const account = { accountNumber, balance: bal.value.value, txns: [...mapTxns(paged.value)] };
  return succeed({ account, degraded: bal.value.degraded });
}

/**
 * Iterate accounts sequentially, short-circuiting on failure.
 * @param d - Driver context.
 * @param accounts - Flat account list.
 * @returns Accounts accumulator procedure.
 */
async function iterateAccounts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  accounts: readonly TAcct[],
): Promise<AcctsAcc> {
  const seedProc: AcctsAcc = succeed([]);
  const seed: Promise<AcctsAcc> = Promise.resolve(seedProc);
  return accounts.reduce(async (prev, acct): Promise<AcctsAcc> => {
    const acc = await prev;
    if (!isOk(acc)) return acc;
    const one = await fetchOneAccount({ ...d, acct });
    if (!isOk(one)) return one;
    return succeed([...acc.value, one.value]);
  }, seed);
}

/**
 * Assemble scrape state from per-account results. Sets `balanceDegraded`
 * to `true` ONLY when at least one account's balance fell back, so a
 * fully-healthy scrape stays byte-identical to the legacy `{ accounts }`
 * shape (the flag is absent). An opt-in resultGuard reads the flag.
 * @param results - Per-account scrape results.
 * @returns Scrape state for the populated scrape slot.
 */
function buildScrapeState(results: readonly IAccountResult[]): IScrapeState {
  const accounts = results.map(r => r.account);
  if (results.some(r => r.degraded)) return { accounts, balanceDegraded: true };
  return { accounts };
}

/**
 * Run the scrape flow under a bound driver context.
 * @param d - Driver context.
 * @returns Action context augmented with the populated scrape slot.
 */
async function runScrape<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<ApiDirectScrapeResult>> {
  const accts = await fetchAccounts(d);
  if (!isOk(accts)) return accts;
  const scraped = await iterateAccounts(d, accts.value);
  if (!isOk(scraped)) return scraped;
  const scrapeState = buildScrapeState(scraped.value);
  const withScrape: ApiDirectScrapeResult = {
    ...d.ctx,
    scrape: some(scrapeState),
  };
  return succeed(withScrape);
}

/**
 * Factory — convert a bank shape into a scrape function.
 * @param shape - Bank-supplied shape declaration (data only).
 * @returns Scrape function consumed by the Pipeline descriptor.
 */
export function buildGenericHeadlessScrape<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): (ctx: IActionContext) => Promise<Procedure<ApiDirectScrapeResult>> {
  return async (ctx): Promise<Procedure<ApiDirectScrapeResult>> => {
    const busProc = resolveApiMediator(ctx, shape.stepName);
    if (!isOk(busProc)) return busProc;
    return runScrape({ shape, bus: busProc.value, ctx });
  };
}

export default buildGenericHeadlessScrape;
