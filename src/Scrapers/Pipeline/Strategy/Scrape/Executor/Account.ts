/**
 * ScrapeExecutor / Account — per-account assembly + sequential
 * iteration for the generic scrape executor. Maps raw bank responses
 * into `ITransactionsAccount` records. Extracted from
 * `ScrapeExecutor.ts` during the Phase 12e file-size drain.
 */

import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IRawAccount } from '../../../Types/ScrapeConfig.js';
import { fetchRawTxns, safeCall } from './Fetch.js';
import type { ExtractedBalance, IBuiltRequest, IScrapeOps } from './Types.js';

/** Recursion cursor for the sequential account walk. */
interface ISeqCursor<TA, TT> {
  readonly ops: IScrapeOps<TA, TT>;
  readonly accounts: readonly IRawAccount[];
  readonly index: number;
}

/** Inputs to {@link assembleAccount} (ops + raw account + raw txn response). */
interface IAssembleInput<TA, TT> {
  readonly ops: IScrapeOps<TA, TT>;
  readonly account: IRawAccount;
  readonly raw: TT;
}

/** Result of a single-account fetch: the assembled account or a failure. */
type AccountResult = Procedure<ITransactionsAccount>;
/** Result of a multi-account fetch: all accounts or the first failure. */
type AccountsResult = Procedure<readonly ITransactionsAccount[]>;

/**
 * Assemble an ITransactionsAccount from a raw account + mapped transactions.
 * @param account - The raw account with ID and balance.
 * @param txns - Mapped transactions.
 * @param balance - Resolved balance (extractor result or account.balance).
 * @returns Assembled account.
 */
function buildAccount(
  account: IRawAccount,
  txns: readonly ITransaction[],
  balance: number,
): ITransactionsAccount {
  return { accountNumber: account.accountId, balance, txns: txns as ITransaction[] };
}

/**
 * Map one account's raw transaction response into typed transactions.
 * @param ops - Bundled scrape operations.
 * @param raw - Raw transactions API response.
 * @returns Procedure with mapped transactions or failure.
 */
function mapTransactions<TA, TT>(
  ops: IScrapeOps<TA, TT>,
  raw: TT,
): Procedure<readonly ITransaction[]> {
  return safeCall(
    (): readonly ITransaction[] => ops.config.transactions.mapper(raw),
    'Transaction mapper',
  );
}

/**
 * Resolve the account balance, preferring the optional balanceExtractor.
 * @param ops - Bundled scrape operations.
 * @param account - The raw account (fallback balance source).
 * @param raw - Raw transactions API response (extractor input).
 * @returns The resolved balance.
 */
function resolveBalance<TA, TT>(ops: IScrapeOps<TA, TT>, account: IRawAccount, raw: TT): number {
  const extractor = ops.config.balanceExtractor;
  if (!extractor) return account.balance;
  const result = safeCall(
    (): ExtractedBalance => extractor(raw) as ExtractedBalance,
    'balanceExtractor',
  );
  return isOk(result) ? result.value : account.balance;
}

/**
 * Fetch the raw transaction data for one account (build request + dispatch).
 * @param ops - Bundled scrape operations.
 * @param account - The raw account to fetch transactions for.
 * @returns Procedure with the raw response or failure.
 */
async function fetchTxnData<TA, TT>(
  ops: IScrapeOps<TA, TT>,
  account: IRawAccount,
): Promise<Procedure<TT>> {
  /**
   * Build this account's transaction request.
   * @returns The path + postData for the txn fetch.
   */
  const make = (): IBuiltRequest =>
    ops.config.transactions.buildRequest(account.accountId, ops.startDate);
  const reqResult = safeCall(make, 'buildRequest');
  if (!isOk(reqResult)) return reqResult;
  return fetchRawTxns(ops, reqResult.value);
}

/**
 * Map raw transactions + resolve balance into an assembled account.
 * @param input - Bundled scrape operations + raw account + raw response.
 * @returns Procedure with the assembled account or failure.
 */
function assembleAccount<TA, TT>(input: IAssembleInput<TA, TT>): AccountResult {
  const { ops, account, raw } = input;
  const mapped = mapTransactions(ops, raw);
  if (!isOk(mapped)) return mapped;
  const balance = resolveBalance(ops, account, raw);
  const built = buildAccount(account, mapped.value, balance);
  return succeed(built);
}

/**
 * Fetch transactions for one account.
 * @param ops - Bundled scrape operations.
 * @param account - The raw account to fetch transactions for.
 * @returns Procedure with ITransactionsAccount or failure.
 */
async function fetchOneAccount<TA, TT>(
  ops: IScrapeOps<TA, TT>,
  account: IRawAccount,
): Promise<AccountResult> {
  const raw = await fetchTxnData(ops, account);
  if (!isOk(raw)) return raw;
  return assembleAccount({ ops, account, raw: raw.value });
}

/**
 * Recursively fetch accounts from a cursor position (sequential mode).
 * @param cursor - The ops + account list + current index.
 * @returns Procedure with all account results from index onward.
 */
async function fetchFrom<TA, TT>(cursor: ISeqCursor<TA, TT>): Promise<AccountsResult> {
  const { ops, accounts, index } = cursor;
  if (index >= accounts.length) return succeed([]);
  const result = await fetchOneAccount(ops, accounts[index]);
  if (!isOk(result)) return result;
  const rest = await fetchFrom({ ops, accounts, index: index + 1 });
  if (!isOk(rest)) return rest;
  return succeed([result.value, ...rest.value]);
}

/**
 * Fetch all accounts sequentially, short-circuiting on the first failure.
 * @param ops - Bundled scrape operations.
 * @param accounts - Raw account list.
 * @returns Procedure with all account results.
 */
async function fetchSequential<TA, TT>(
  ops: IScrapeOps<TA, TT>,
  accounts: readonly IRawAccount[],
): Promise<AccountsResult> {
  return fetchFrom({ ops, accounts, index: 0 });
}

export default fetchSequential;
