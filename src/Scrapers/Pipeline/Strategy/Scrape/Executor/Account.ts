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

/**
 * Assemble an ITransactionsAccount from raw account + mapped transactions.
 * @param account - The raw account with ID and balance.
 * @param txns - Mapped transactions.
 * @param balance - Override balance (from balanceExtractor, or account.balance).
 * @returns Assembled account.
 */
function buildAccount(
  account: IRawAccount,
  txns: readonly ITransaction[],
  balance: number,
): ITransactionsAccount {
  return {
    accountNumber: account.accountId,
    balance,
    txns: txns as ITransaction[],
  } satisfies ITransactionsAccount;
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
): Promise<Procedure<ITransactionsAccount>> {
  const txnCfg = ops.config.transactions;
  /**
   * Build the fetch request for this account.
   * @returns URL path and POST data.
   */
  const buildReq = (): IBuiltRequest => txnCfg.buildRequest(account.accountId, ops.startDate);
  const reqResult = safeCall(buildReq, 'buildRequest');
  if (!isOk(reqResult)) return reqResult;
  const raw = await fetchRawTxns(ops, reqResult.value);
  if (!isOk(raw)) return raw;
  /**
   * Map raw response to typed transactions.
   * @returns Mapped transaction array.
   */
  const mapTxns = (): readonly ITransaction[] => txnCfg.mapper(raw.value);
  const mapped = safeCall(mapTxns, 'Transaction mapper');
  if (!isOk(mapped)) return mapped;
  const extractor = ops.config.balanceExtractor;
  let balance: Procedure<number> = succeed(account.balance);
  if (extractor) {
    balance = safeCall(
      (): ExtractedBalance => extractor(raw.value) as ExtractedBalance,
      'balanceExtractor',
    );
  }
  let resolvedBalance = account.balance;
  if (isOk(balance)) {
    resolvedBalance = balance.value;
  }
  const acct = buildAccount(account, mapped.value, resolvedBalance);
  return succeed(acct);
}

/**
 * Fetch all accounts recursively (sequential mode).
 * @param ops - Bundled scrape operations.
 * @param accounts - Raw account list.
 * @param index - Current index.
 * @returns Procedure with all account results.
 */
async function fetchSequential<TA, TT>(
  ops: IScrapeOps<TA, TT>,
  accounts: readonly IRawAccount[],
  index: number,
): Promise<Procedure<readonly ITransactionsAccount[]>> {
  if (index >= accounts.length) return succeed([]);
  const result = await fetchOneAccount(ops, accounts[index]);
  if (!isOk(result)) return result;
  const rest = await fetchSequential(ops, accounts, index + 1);
  if (!isOk(rest)) return rest;
  return succeed([result.value, ...rest.value]);
}

export default fetchSequential;
