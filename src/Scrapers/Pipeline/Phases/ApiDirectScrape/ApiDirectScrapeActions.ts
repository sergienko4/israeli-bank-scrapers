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
import { reportMapRejects } from '../../Mediator/Scrape/CoverageAudit/MapRejects.js';
import { autoMapTransaction } from '../../Mediator/Scrape/ScrapeAutoMapper.js';
import { applyStartWindow } from '../../Mediator/Scrape/StartWindow.js';
import { collapseDuplicates } from '../../Mediator/Scrape/TxnDedup.js';
import { isSome, some } from '../../Types/Option.js';
import type { IActionContext, IScrapeState } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { collectAccountRows } from './ApiDirectScrapeBackfill.js';
import runBootstrap from './ApiDirectScrapeBootstrap.js';
import type { IAcctCtx, IDriverCtx } from './ApiDirectScrapeDispatchArgs.js';
import runPrime from './ApiDirectScrapePrime.js';
import { fetchAccounts, fetchBalance } from './ApiDirectScrapeSteps.js';
import type { ApiDirectScrapeResult } from './ApiDirectScrapeTypes.js';
import type { IApiDirectScrapeShape } from './IApiDirectScrapeShape.js';

/** One account plus the outcome facts its walk produced. */
interface IAccountResult {
  readonly account: ITransactionsAccount;
  readonly degraded: boolean;
  /** Backfill was asked for the missing slice and did not get it. */
  readonly backfillExhausted: boolean;
}

/** Accumulator for per-account scrape results. */
type AcctsAcc = Procedure<readonly IAccountResult[]>;

/**
 * Map raw rows through autoMapTransaction (drops rejects).
 * @param raws - Raw rows emitted by the shape's extractPage.
 * @param isCardIssuer - Declared by the shape; decides charge-sign handling.
 * @returns Mapped ITransactions (rejects filtered out).
 */
function mapTxns(raws: readonly object[], isCardIssuer?: boolean): readonly ITransaction[] {
  const widened = raws as unknown as readonly Record<string, unknown>[];
  const mapped = widened.map((raw): ITransaction | false => autoMapTransaction(raw, isCardIssuer));
  return mapped.filter((t): t is ITransaction => t !== false);
}

/**
 * Map the shape's raw rows, reporting any the mapper refused.
 *
 * The refusals are reported here rather than swallowed because the shape found
 * those rows and believed them transactions — a non-zero count is data that
 * reached us and was dropped, which the totals alone would never reveal.
 *
 * @param a - Per-account context.
 * @param raws - Raw rows emitted by the shape's extractPage.
 * @param label - Bank + step identity for the log line.
 * @returns The rows the mapper accepted.
 */
function mapAndReport<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  raws: readonly object[],
  label: string,
): readonly ITransaction[] {
  const mapped = mapTxns(raws, a.shape.isCardIssuer);
  reportMapRejects({ extracted: raws.length, mapped: mapped.length, label });
  return mapped;
}

/**
 * Refine one account's raw rows into the transactions the caller asked for.
 *
 * Reports the rows the mapper refused first, then collapses proven duplicates
 * (opt-in; no bank declares a key today) and trims to the caller's `startDate`.
 * Providers return whole billing cycles rather than a date range, so without
 * the window the caller receives months of history it never asked for.
 *
 * @param a - Per-account context.
 * @param raws - Raw rows emitted by the shape's extractPage.
 * @returns Mapped, deduplicated, in-window transactions.
 */
function refineTxns<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  raws: readonly object[],
): readonly ITransaction[] {
  const label = `${a.ctx.companyId}/txns`;
  const mapped = mapAndReport(a, raws, label);
  const keyFields = a.shape.transactions.dedupKeyFields ?? [];
  const unique = collapseDuplicates({ txns: mapped, keyFields, label });
  return applyStartWindow({ txns: unique.kept, startDate: a.ctx.options.startDate, label }).kept;
}

/** One account's transactions plus the facts its walk produced. */
interface IAccountTxns {
  readonly txns: readonly ITransaction[];
  /** Backfill was asked for the missing slice and did not get it. */
  readonly backfillExhausted: boolean;
}

/**
 * Fetch + map one account's paginated transactions.
 *
 * Carries the backfill outcome out with the rows: a short window and a
 * complete one yield the same transaction list, so dropping the flag here
 * would put the loss back out of reach of every caller above.
 *
 * @param a - Per-account context.
 * @returns Mapped, in-window transactions plus the backfill outcome.
 */
async function fetchAccountTxns<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IAccountTxns>> {
  const collected = await collectAccountRows(a);
  if (!isOk(collected)) return collected;
  const txns = refineTxns(a, collected.value.rows);
  return succeed({ txns, backfillExhausted: collected.value.isBackfillExhausted });
}

/**
 * Assemble one account — balance + txns + outcome flags.
 * @param a - Per-account context.
 * @returns Account-result procedure (account + balance and backfill outcomes).
 */
async function fetchOneAccount<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IAccountResult>> {
  const bal = await fetchBalance(a);
  if (!isOk(bal)) return bal;
  const txns = await fetchAccountTxns(a);
  if (!isOk(txns)) return txns;
  const accountNumber = a.shape.accountNumberOf(a.acct);
  const account = { accountNumber, balance: bal.value.value, txns: [...txns.value.txns] };
  const wasExhausted = txns.value.backfillExhausted;
  return succeed({ account, degraded: bal.value.degraded, backfillExhausted: wasExhausted });
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
 * shape's resultGuard inspects) and whether any account's backfill was
 * spent without covering the requested window.
 * @param results - Per-account results from the sequential walk.
 * @returns Scrape state with accounts + the two outcome flags.
 */
function summarizeScrape(results: readonly IAccountResult[]): IScrapeState {
  const accounts = results.map(r => r.account);
  const hasDegraded = results.some(r => r.degraded);
  const hasExhausted = results.some(r => r.backfillExhausted);
  return { accounts, balanceDegraded: hasDegraded, backfillExhausted: hasExhausted };
}

/**
 * Run the scrape flow under a bound driver context.
 * @param d - Driver context.
 * @returns Action context augmented with the populated scrape slot.
 */
async function runScrape<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<ApiDirectScrapeResult>> {
  await runPrime(d);
  const primed = await runBootstrap(d);
  if (!isOk(primed)) return primed;
  const accts = await fetchAccounts(d);
  if (!isOk(accts)) return accts;
  const scraped = await iterateAccounts(d, accts.value);
  if (!isOk(scraped)) return scraped;
  const summary = summarizeScrape(scraped.value);
  const withScrape: ApiDirectScrapeResult = { ...d.ctx, scrape: some(summary) };
  return succeed(withScrape);
}

/**
 * Recognize a degraded scrape SLOT: a balance fallback fired OR the
 * authenticated call returned zero accounts.
 *
 * An empty-but-authenticated body is a known server-degraded warm-session
 * shape — the cached token still authenticates yet the backend silently
 * returns nothing. On the warm direct-API path this must count as suspicious so
 * self-heal can fire. The rule is bounded: recovery is warm-gated (see
 * {@link shouldRecoverSession}) and recover-once, so a direct-API account that
 * legitimately holds zero accounts re-runs at most once and then surfaces the
 * same empty result unmasked.
 * @param state - The populated scrape slot.
 * @returns True when the slot is empty or balance-degraded.
 */
function isDegradedScrapeState(state: IScrapeState): boolean {
  // Strict `=== true`: balanceDegraded is a validated boolean — never coerce.
  return state.accounts.length === 0 || state.balanceDegraded === true;
}

/**
 * Decide whether a scrape outcome warrants a session-recovery attempt: a hard
 * failure OR a degraded scrape slot (see {@link isDegradedScrapeState}).
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
 * @returns True when the scrape failed or reported a degraded slot.
 */
function isScrapeSuspicious(first: Procedure<ApiDirectScrapeResult>): boolean {
  if (!isOk(first)) return true;
  const { scrape } = first.value;
  return isSome(scrape) && isDegradedScrapeState(scrape.value);
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
