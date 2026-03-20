/**
 * Generic scrape executor — reads IScrapeConfig, fetches accounts + transactions.
 * Banks provide config (URLs, mappers). This module handles fetch, iteration, assembly.
 */

import moment from 'moment';

import type { ITransactionsAccount } from '../../../Transactions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IFetchOpts, IFetchStrategy } from '../Strategy/FetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../Strategy/FetchStrategy.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
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

/** Fetch dispatch arguments. */
interface IDispatchArgs {
  readonly strategy: IFetchStrategy;
  readonly method: string;
  readonly path: string;
  readonly postData: Record<string, string>;
  readonly opts: IFetchOpts;
}

/**
 * Dispatch a fetch call by HTTP method.
 * @param args - Bundled fetch arguments.
 * @returns Procedure with the response.
 */
function dispatchFetch<TResult>(args: IDispatchArgs): Promise<Procedure<TResult>> {
  if (args.method === 'POST')
    return args.strategy.fetchPost<TResult>(args.path, args.postData, args.opts);
  return args.strategy.fetchGet<TResult>(args.path, args.opts);
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
  const raw = await dispatchFetch<TA>({
    strategy: ops.strategy,
    method: acctCfg.method,
    path: acctCfg.path,
    postData: acctCfg.postData,
    opts: ops.opts,
  });
  if (!isOk(raw)) return raw;
  try {
    const accounts = acctCfg.mapper(raw.value);
    return succeed(accounts);
  } catch (error) {
    const msg = toErrorMessage(error);
    return fail(ScraperErrorTypes.Generic, `Account mapper failed: ${msg}`);
  }
}

/**
 * Safely call a bank-provided callback, wrapping thrown errors as Procedure failure.
 * @param fn - The bank callback to execute.
 * @param label - Error label for diagnostics (e.g. 'buildRequest').
 * @returns Procedure with the callback result or a failure.
 */
function safeCall<T>(fn: () => T, label: string): Procedure<T> {
  try {
    const result = fn();
    return succeed(result);
  } catch (error) {
    const msg = toErrorMessage(error);
    return fail(ScraperErrorTypes.Generic, `${label} failed: ${msg}`);
  }
}

/** Built request from bank's buildRequest callback. */
interface IBuiltRequest {
  readonly path: string;
  readonly postData: Record<string, string>;
}

/**
 * Fetch raw transaction data for one account via strategy.
 * @param ops - Bundled scrape operations.
 * @param req - Built request from buildRequest callback.
 * @returns Procedure with raw response or failure.
 */
async function fetchRawTxns<TA, TT>(
  ops: IScrapeOps<TA, TT>,
  req: IBuiltRequest,
): Promise<Procedure<TT>> {
  return dispatchFetch<TT>({
    strategy: ops.strategy,
    method: ops.config.transactions.method,
    path: req.path,
    postData: req.postData,
    opts: ops.opts,
  });
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
  const reqResult = safeCall(
    () => txnCfg.buildRequest(account.accountId, ops.startDate),
    'buildRequest',
  );
  if (!isOk(reqResult)) return reqResult;
  const raw = await fetchRawTxns(ops, reqResult.value);
  if (!isOk(raw)) return raw;
  const mapped = safeCall(() => txnCfg.mapper(raw.value), 'Transaction mapper');
  if (!isOk(mapped)) return mapped;
  const txns = [...mapped.value];
  return succeed({ accountNumber: account.accountId, balance: account.balance, txns });
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
