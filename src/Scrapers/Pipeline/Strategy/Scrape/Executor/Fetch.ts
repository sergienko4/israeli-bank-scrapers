/**
 * ScrapeExecutor / Fetch — transport + request helpers for the generic
 * scrape executor. Reads `IScrapeConfig` and dispatches account/txn
 * fetches via the injected `IFetchStrategy`. Extracted from
 * `ScrapeExecutor.ts` during the Phase 12e file-size drain.
 */

import moment from 'moment';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IRawAccount, IScrapeConfig } from '../../../Types/ScrapeConfig.js';
import type { IFetchOpts } from '../../Fetch/FetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../../Fetch/FetchStrategy.js';
import type { IBuiltRequest, IDispatchArgs, IScrapeOps, StartDateFormatted } from './Types.js';

/** Default transaction look-back amount when the caller supplies no earlier start date. */
const DEFAULT_LOOKBACK_AMOUNT = 1;
/** Default transaction look-back unit (paired with {@link DEFAULT_LOOKBACK_AMOUNT}). */
const DEFAULT_LOOKBACK_UNIT = 'years' as const;
/** HTTP verb that carries a request body (POST) vs. a query-only GET. */
const HTTP_METHOD_POST = 'POST';

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
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `${label} failed: ${msg}`);
  }
}

/**
 * Build fetch options with bank-specific headers.
 * @param config - The scrape config with header factory.
 * @param ctx - Pipeline context for header resolution.
 * @returns IFetchOpts with extraHeaders, or DEFAULT_FETCH_OPTS when none.
 */
function buildFetchOpts<TA, TT>(config: IScrapeConfig<TA, TT>, ctx: IPipelineContext): IFetchOpts {
  const headersResult = safeCall(
    (): Record<string, string> => config.extraHeaders(ctx),
    'extraHeaders',
  );
  if (!isOk(headersResult)) return DEFAULT_FETCH_OPTS;
  const extraHeaders = headersResult.value;
  if (Object.keys(extraHeaders).length === 0) return DEFAULT_FETCH_OPTS;
  return { extraHeaders };
}

/**
 * Compute start date string from options and config.
 * @param ctx - Pipeline context with options.
 * @param dateFormat - The bank's date format string.
 * @returns Formatted start date.
 */
function computeStartDate(ctx: IPipelineContext, dateFormat: string): StartDateFormatted {
  const defaultStart = moment().subtract(DEFAULT_LOOKBACK_AMOUNT, DEFAULT_LOOKBACK_UNIT);
  const optionsStart = moment(ctx.options.startDate);
  const start = moment.max(defaultStart, optionsStart);
  return start.format(dateFormat) as StartDateFormatted;
}

/**
 * Build dispatch arguments for the accounts endpoint.
 * @param ops - Bundled scrape operations.
 * @returns Dispatch arguments for the account-list fetch.
 */
function accountDispatchArgs<TA, TT>(ops: IScrapeOps<TA, TT>): IDispatchArgs {
  return {
    strategy: ops.strategy,
    method: ops.config.accounts.method,
    path: ops.config.accounts.path,
    postData: ops.config.accounts.postData,
    opts: ops.opts,
  };
}

/**
 * Build dispatch arguments for one account's transactions endpoint.
 * @param ops - Bundled scrape operations.
 * @param req - Built request from the bank's buildRequest callback.
 * @returns Dispatch arguments for the transaction fetch.
 */
function txnDispatchArgs<TA, TT>(ops: IScrapeOps<TA, TT>, req: IBuiltRequest): IDispatchArgs {
  return {
    strategy: ops.strategy,
    method: ops.config.transactions.method,
    path: req.path,
    postData: req.postData,
    opts: ops.opts,
  };
}

/**
 * Dispatch a fetch call by HTTP method.
 * @param args - Bundled fetch arguments.
 * @returns Procedure with the response.
 */
function dispatchFetch<TResult>(args: IDispatchArgs): Promise<Procedure<TResult>> {
  if (args.method === HTTP_METHOD_POST)
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
  const args = accountDispatchArgs(ops);
  const raw = await dispatchFetch<TA>(args);
  if (!isOk(raw)) return raw;
  /**
   * Map the raw accounts response into typed accounts.
   * @returns Mapped raw accounts.
   */
  const map = (): readonly IRawAccount[] => ops.config.accounts.mapper(raw.value);
  return safeCall(map, 'Account mapper');
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
  const args = txnDispatchArgs(ops, req);
  return dispatchFetch<TT>(args);
}

export { buildFetchOpts, computeStartDate, fetchAccountList, fetchRawTxns, safeCall };
