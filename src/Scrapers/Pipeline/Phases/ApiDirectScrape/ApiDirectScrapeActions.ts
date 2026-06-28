/**
 * ApiDirectScrape phase actions — Zero-Logic Bank Folder pattern.
 * Banks supply an IApiDirectScrapeShape (data only); this file walks
 * customer → per-account (balance + paginated transactions), maps
 * rows via autoMapTransaction, and returns the scrape procedure.
 * Per-step helpers live in ApiDirectScrapeSteps.ts to keep this
 * file under the per-file LOC ceiling. Zero bank-name coupling.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import type { IApiMediator } from '../../Mediator/Api/ApiMediator.js';
import { resolveApiMediator } from '../../Mediator/Api/ApiMediatorAccessor.js';
import { autoMapTransaction } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { fetchPaginated } from '../../Strategy/Fetch/Pagination.js';
import { isSome, some } from '../../Types/Option.js';
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

/** One account plus whether its balance fetch fell back to a default. */
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
 * Fetch + map one account's paginated transactions.
 * @param a - Per-account context.
 * @returns Mapped transactions procedure.
 */
async function fetchAccountTxns<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<readonly ITransaction[]>> {
  const fetchPage = buildPageFetcher(a);
  const stop = buildStop(a);
  const paged = await fetchPaginated<object, TCursor>({ fetchPage, stop });
  if (!isOk(paged)) return paged;
  const mapped = mapTxns(paged.value);
  return succeed(mapped);
}

/**
 * Assemble one account — balance + txns + degraded flag.
 * @param a - Per-account context.
 * @returns Account-result procedure (account + balance outcome).
 */
async function fetchOneAccount<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IAccountResult>> {
  const bal = await fetchBalance(a);
  if (!isOk(bal)) return bal;
  const txns = await fetchAccountTxns(a);
  if (!isOk(txns)) return txns;
  const accountNumber = a.shape.accountNumberOf(a.acct);
  const account = { accountNumber, balance: bal.value.value, txns: [...txns.value] };
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
 * Fold per-account results into the scrape slot, surfacing whether any
 * account's balance fetch fell back (the degraded warm-session signal a
 * shape's resultGuard inspects).
 * @param results - Per-account results from the sequential walk.
 * @returns Scrape state with accounts + balanceDegraded flag.
 */
function summarizeScrape(results: readonly IAccountResult[]): IScrapeState {
  const accounts = results.map(r => r.account);
  const hasDegraded = results.some(r => r.degraded);
  return { accounts, balanceDegraded: hasDegraded };
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
  const summary = summarizeScrape(scraped.value);
  const withScrape: ApiDirectScrapeResult = { ...d.ctx, scrape: some(summary) };
  return succeed(withScrape);
}

/**
 * Decide whether a scrape outcome warrants a session-recovery attempt: a hard
 * failure OR a degraded-balance signal.
 *
 * `balanceDegraded` is set by ANY balance fallback — including a transient 5xx
 * unrelated to the token — not only an auth-shaped rejection. This conflation
 * is DELIBERATE: a silently server-rejected warm token most reliably surfaces
 * as a balance fallback, and the blast radius is already bounded — recovery is
 * gated on a warm session (cold sessions never recover, see
 * {@link shouldRecoverSession}) and runs at most once (recover-once). Splitting
 * transient-vs-auth here would require threading the failure shape through
 * IBalanceOutcome, which the bank result guards consume with the current
 * any-fallback meaning. Worst case: one unnecessary OTP on a warm session that
 * hit a transient balance hiccup.
 * @param first - The first scrape procedure.
 * @returns True when the scrape failed or reported a degraded balance.
 */
function isScrapeSuspicious(first: Procedure<ApiDirectScrapeResult>): boolean {
  if (!isOk(first)) return true;
  const { scrape } = first.value;
  // Strict `=== true`: balanceDegraded is a validated boolean — never coerce.
  return isSome(scrape) && scrape.value.balanceDegraded === true;
}

/**
 * Gate recovery on BOTH a suspicious outcome AND a warm (cached-token) session.
 * A cold session already ran the full login flow, so recovering would only
 * burn a second OTP; a healthy warm session needs no recovery.
 * @param first - The first scrape procedure.
 * @param bus - The bound ApiMediator.
 * @returns True when recovery should run.
 */
function shouldRecoverSession(first: Procedure<ApiDirectScrapeResult>, bus: IApiMediator): boolean {
  return isScrapeSuspicious(first) && bus.wasSessionWarm();
}

/**
 * Run the scrape; when a warm session yields a suspicious outcome, discard the
 * cached token (full cold re-login via recoverSession) and re-run once. A
 * failed recovery returns the first outcome unchanged so a loud failure or a
 * degraded result is never masked. Shared by every api-direct bank with zero
 * per-bank coupling.
 * @param d - Driver context.
 * @returns Scrape procedure (recovered when warranted).
 */
async function runScrapeWithRecovery<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<ApiDirectScrapeResult>> {
  const first = await runScrape(d);
  if (!shouldRecoverSession(first, d.bus)) return first;
  const recovered = await d.bus.recoverSession();
  if (!isOk(recovered)) return first;
  return runScrape(d);
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
    return runScrapeWithRecovery({ shape, bus: busProc.value, ctx });
  };
}

export default buildGenericHeadlessScrape;
