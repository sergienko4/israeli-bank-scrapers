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
 * @returns IFetchOpts with extraHeaders.
 */
function buildFetchOpts<TA, TT>(config: IScrapeConfig<TA, TT>, ctx: IPipelineContext): IFetchOpts {
  const headersResult = safeCall(
    (): Record<string, string> => config.extraHeaders(ctx),
    'extraHeaders',
  );
  if (!isOk(headersResult)) return DEFAULT_FETCH_OPTS;
  const extraHeaders = headersResult.value;
  const hasHeaders = Object.keys(extraHeaders).length > 0;
  if (!hasHeaders) return DEFAULT_FETCH_OPTS;
  const opts: IFetchOpts = { extraHeaders };
  return opts;
}

/**
 * Compute start date string from options and config.
 * @param ctx - Pipeline context with options.
 * @param dateFormat - The bank's date format string.
 * @returns Formatted start date.
 */
function computeStartDate(ctx: IPipelineContext, dateFormat: string): StartDateFormatted {
  const defaultStart = moment().subtract(1, 'years');
  const optionsStart = moment(ctx.options.startDate);
  const start = moment.max(defaultStart, optionsStart);
  return start.format(dateFormat) as StartDateFormatted;
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
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `Account mapper failed: ${msg}`);
  }
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

export { buildFetchOpts, computeStartDate, fetchAccountList, fetchRawTxns, safeCall };
