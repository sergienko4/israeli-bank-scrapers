/**
 * Generic scrape executor — reads IScrapeConfig, fetches accounts + transactions.
 * Banks provide config (URLs, mappers). This module handles fetch, iteration, assembly.
 */

import moment from 'moment';

import type { ITransactionsAccount } from '../../../Transactions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IFetchOpts, IFetchStrategy } from '../Strategy/FetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../Strategy/FetchStrategy.js';
import { some } from '../Types/Option.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, isOk, succeed } from '../Types/Procedure.js';
import type { IRawAccount, IScrapeConfig } from '../Types/ScrapeConfig.js';

/** Bundled dependencies for scrape operations. */
interface IScrapeOps<TA, TT> {
  readonly strategy: IFetchStrategy;
  readonly config: IScrapeConfig<TA, TT>;
  readonly opts: IFetchOpts;
  readonly startDate: string;
}

/**
 * Build fetch options with bank-specific headers.
 * @param config - The scrape config with header factory.
 * @param ctx - Pipeline context for header resolution.
 * @returns IFetchOpts with extraHeaders.
 */
function buildFetchOpts<TA, TT>(config: IScrapeConfig<TA, TT>, ctx: IPipelineContext): IFetchOpts {
  const extraHeaders = config.extraHeaders(ctx);
  const hasHeaders = Object.keys(extraHeaders).length > 0;
  if (!hasHeaders) return DEFAULT_FETCH_OPTS;
  return { extraHeaders };
}

/**
 * Compute start date string from options and config.
 * @param ctx - Pipeline context with options.
 * @param dateFormat - The bank's date format string.
 * @returns Formatted start date.
 */
function computeStartDate(ctx: IPipelineContext, dateFormat: string): string {
  const defaultStart = moment().subtract(1, 'years');
  const optionsStart = moment(ctx.options.startDate);
  const start = moment.max(defaultStart, optionsStart);
  return start.format(dateFormat);
}

/**
 * Fetch the account list from the bank API.
 * @param ops - Bundled scrape operations.
 * @returns Procedure with raw accounts or failure.
 */
async function fetchAccountList<TA, TT>(
  ops: IScrapeOps<TA, TT>,
): Promise<Procedure<readonly IRawAccount[]>> {
  const acctCfg = ops.config.accounts;
  const isPost = acctCfg.method === 'POST';
  const raw = isPost
    ? await ops.strategy.fetchPost<TA>(acctCfg.path, acctCfg.postData, ops.opts)
    : await ops.strategy.fetchGet<TA>(acctCfg.path, ops.opts);
  if (!isOk(raw)) return raw;
  const accounts = acctCfg.mapper(raw.value);
  return succeed(accounts);
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
  const req = txnCfg.buildRequest(account.accountId, ops.startDate);
  const isPost = txnCfg.method === 'POST';
  const raw = isPost
    ? await ops.strategy.fetchPost<TT>(req.path, req.postData, ops.opts)
    : await ops.strategy.fetchGet<TT>(req.path, ops.opts);
  if (!isOk(raw)) return raw;
  const txns = txnCfg.mapper(raw.value);
  return succeed({
    accountNumber: account.accountId,
    balance: account.balance,
    txns: [...txns],
  });
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

/**
 * Execute the generic scrape flow.
 * @param ctx - Pipeline context with fetchStrategy.
 * @param config - The bank's scrape configuration.
 * @returns Updated context with scrape.accounts populated.
 */
async function executeScrape<TA, TT>(
  ctx: IPipelineContext,
  config: IScrapeConfig<TA, TT>,
): Promise<Procedure<IPipelineContext>> {
  if (!ctx.fetchStrategy.has) {
    return fail(ScraperErrorTypes.Generic, 'No fetchStrategy in context');
  }
  const ops: IScrapeOps<TA, TT> = {
    strategy: ctx.fetchStrategy.value,
    config,
    opts: buildFetchOpts(config, ctx),
    startDate: computeStartDate(ctx, config.dateFormat),
  };
  const accountsResult = await fetchAccountList(ops);
  if (!isOk(accountsResult)) return accountsResult;

  const txnResult = await fetchSequential(ops, accountsResult.value, 0);
  if (!isOk(txnResult)) return txnResult;

  return succeed({ ...ctx, scrape: some({ accounts: txnResult.value }) });
}

export default executeScrape;
export { executeScrape };
