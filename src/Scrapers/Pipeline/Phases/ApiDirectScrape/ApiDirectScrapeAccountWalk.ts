/**
 * Per-account walk for the ApiDirectScrape phase driver.
 *
 * <p>Each account is visited in turn — balance, then paginated transactions —
 * and its published account plus outcome facts are accumulated. The walk is
 * sequential and short-circuits on the first failure, so a failing account
 * never leaves a half-assembled scrape behind. Split out of
 * ApiDirectScrapeActions.ts to keep both files under the per-file LOC ceiling.
 * Zero bank-name coupling.
 */

import type { WindowCaveat } from '../../../../WindowCoverage.js';
import { makeEvidenceLedger } from '../../Mediator/Scrape/CoverageAudit/EvidenceLedger.js';
import type { IAuditedAccount } from '../../Types/Domain/AuditedAccount.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type { IAccountTxns } from './ApiDirectScrapeAccountTxns.js';
import { fetchAccountTxns } from './ApiDirectScrapeAccountTxns.js';
import { fetchBalance } from './ApiDirectScrapeBalance.js';
import type { IAcctCtx, IDriverCtx } from './ApiDirectScrapeTypes.js';
import type { IBalanceOutcome } from './IApiDirectScrapeShape.js';

/** One account plus the outcome facts its walk produced. */
export interface IAccountResult {
  readonly account: IAuditedAccount;
  readonly degraded: boolean;
  /** Backfill was asked for the missing slice and did not get it. */
  readonly backfillExhausted: boolean;
  readonly observedCaveats: readonly WindowCaveat[];
}

/** Accumulator for per-account scrape results. */
type AcctsAcc = Procedure<readonly IAccountResult[]>;

/**
 * Build the account's balance field — OMITTED when the figure is unknown.
 *
 * `ITransactionsAccount.balance` is optional, so leaving the key out is the
 * only truthful way to say "we do not know". Emitting `0` would publish a
 * number the bank never gave us; emitting `undefined` would still create the
 * key, so `'balance' in account` and `Object.keys` would both report a
 * balance the bank never sent.
 * @param outcome - Balance outcome from the balance step.
 * @returns Either `{ balance }` or an empty object.
 */
function balanceField(outcome: IBalanceOutcome): { balance?: number } {
  if (outcome.value === undefined) return {};
  return { balance: outcome.value };
}

/**
 * Assemble the published account from its number, balance and rows.
 * @param accountNumber - The shape's user-facing account number.
 * @param bal - Balance outcome from the balance step.
 * @param txns - Rows and window facts from the transactions step.
 * @returns The audited account.
 */
function heldAccount(
  accountNumber: string,
  bal: IBalanceOutcome,
  txns: IAccountTxns,
): IAuditedAccount {
  const { windowCoverage } = txns;
  const held = { txns: [...txns.txns], windowCoverage };
  return { accountNumber, ...balanceField(bal), ...held };
}

/**
 * Assemble the outcome facts one account's walk produced.
 * @param bal - Balance outcome from the balance step.
 * @param txns - Rows and window facts from the transactions step.
 * @returns The degraded, backfill and caveat flags.
 */
function outcomeOf(bal: IBalanceOutcome, txns: IAccountTxns): Omit<IAccountResult, 'account'> {
  const isDegraded = bal.degraded;
  const isBackfillExhausted = txns.backfillExhausted;
  const observedCaveats = txns.observedCaveats;
  return { degraded: isDegraded, backfillExhausted: isBackfillExhausted, observedCaveats };
}

/**
 * Assemble one account's published record and the outcome facts its walk
 * produced.
 * @param a - Per-account context, whose shape names the account.
 * @param bal - Balance outcome from the balance step.
 * @param txns - Rows and window facts from the transactions step.
 * @returns The account plus its degraded, backfill and caveat facts.
 */
function accountResult<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  bal: IBalanceOutcome,
  txns: IAccountTxns,
): IAccountResult {
  const accountNumber = a.shape.accountNumberOf(a.acct);
  const account = heldAccount(accountNumber, bal, txns);
  return { account, ...outcomeOf(bal, txns) };
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
  const result = accountResult(a, bal.value, txns.value);
  return succeed(result);
}

/**
 * Give one account its own context and a fresh evidence ledger.
 * @param d - Driver context.
 * @param acct - The account under assembly.
 * @returns Per-account context.
 */
function withAccountCtx<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  acct: TAcct,
): IAcctCtx<TAcct, TCursor> {
  return { ...d, acct, ledger: makeEvidenceLedger() };
}

/**
 * Append one account's result, short-circuiting on the first failure.
 * @param prev - Results accumulated so far.
 * @param ctx - Per-account context.
 * @returns Accumulator carrying the new result, or the failure.
 */
async function appendAccount<TAcct, TCursor>(
  prev: Promise<AcctsAcc>,
  ctx: IAcctCtx<TAcct, TCursor>,
): Promise<AcctsAcc> {
  const acc = await prev;
  if (!isOk(acc)) return acc;
  const one = await fetchOneAccount(ctx);
  if (!isOk(one)) return one;
  return succeed([...acc.value, one.value]);
}

/**
 * The empty accumulator every account walk starts from.
 * @returns A resolved success carrying no results.
 */
function emptyAcc(): Promise<AcctsAcc> {
  const results: readonly IAccountResult[] = [];
  const acc = succeed(results);
  return Promise.resolve(acc);
}

/**
 * Append one account to the accumulator, binding its context first.
 * @param d - Driver context.
 * @param acct - The account to walk.
 * @param prev - Results accumulated so far.
 * @returns Accumulator carrying the new result, or the failure.
 */
function extendAcc<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  acct: TAcct,
  prev: Promise<AcctsAcc>,
): Promise<AcctsAcc> {
  const ctx = withAccountCtx(d, acct);
  return appendAccount(prev, ctx);
}

/**
 * Iterate accounts sequentially, short-circuiting on failure.
 * @param d - Driver context.
 * @param accounts - Flat account list.
 * @returns Accounts accumulator procedure.
 */
export function iterateAccounts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  accounts: readonly TAcct[],
): Promise<AcctsAcc> {
  const seed = emptyAcc();
  return accounts.reduce((prev, acct): Promise<AcctsAcc> => extendAcc(d, acct, prev), seed);
}
