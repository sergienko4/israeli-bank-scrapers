/**
 * Generic headless scrape driver — Zero-Logic Bank Folder pattern.
 * Banks supply an IHeadlessScrapeShape (data only); this file walks
 * customer → per-account (balance + paginated transactions), maps
 * rows via autoMapTransaction, and returns the scrape procedure.
 * Per-step helpers live in GenericHeadlessScrapeSteps.ts to keep
 * this file under the per-file LOC ceiling. Zero bank-name coupling.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { resolveApiMediator } from '../../Mediator/Api/ApiMediatorAccessor.js';
import { autoMapTransaction } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { fetchPaginated } from '../../Strategy/Fetch/Pagination.js';
import { some } from '../../Types/Option.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import {
  buildPageFetcher,
  buildStop,
  fetchAccounts,
  fetchBalance,
  type IAcctCtx,
  type IDriverCtx,
} from './GenericHeadlessScrapeSteps.js';
import type { IHeadlessScrapeShape } from './HeadlessScrapeShape.js';

/** Accumulator for per-account scrape results. */
type AcctsAcc = Procedure<readonly ITransactionsAccount[]>;

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
): Promise<Procedure<ITransactionsAccount>> {
  const bal = await fetchBalance(a);
  if (!isOk(bal)) return bal;
  const fetchPage = buildPageFetcher(a);
  const stop = buildStop(a);
  const paged = await fetchPaginated<object, TCursor>({ fetchPage, stop });
  if (!isOk(paged)) return paged;
  const accountNumber = a.shape.accountNumberOf(a.acct);
  const txns = [...mapTxns(paged.value)];
  return succeed({ accountNumber, balance: bal.value, txns });
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
 * Run the scrape flow under a bound driver context.
 * @param d - Driver context.
 * @returns Updated pipeline context procedure.
 */
async function runScrape<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<IPipelineContext>> {
  const accts = await fetchAccounts(d);
  if (!isOk(accts)) return accts;
  const scraped = await iterateAccounts(d, accts.value);
  if (!isOk(scraped)) return scraped;
  const full = d.ctx as unknown as IPipelineContext;
  const withScrape = { ...full, scrape: some({ accounts: scraped.value }) };
  return succeed(withScrape);
}

/**
 * Factory — convert a bank shape into a scrape function.
 * @param shape - Bank-supplied shape declaration (data only).
 * @returns Scrape function consumed by the Pipeline descriptor.
 */
export function buildGenericHeadlessScrape<TAcct, TCursor>(
  shape: IHeadlessScrapeShape<TAcct, TCursor>,
): (ctx: IActionContext) => Promise<Procedure<IPipelineContext>> {
  return async (ctx): Promise<Procedure<IPipelineContext>> => {
    const busProc = resolveApiMediator(ctx, shape.stepName);
    if (!isOk(busProc)) return busProc;
    return runScrape({ shape, bus: busProc.value, ctx });
  };
}

export default buildGenericHeadlessScrape;
