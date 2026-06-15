/**
 * ScrapeExecutor / Execute — orchestrator for the generic scrape flow.
 * Reads `IScrapeConfig`, fetches the account list, then iterates
 * transactions per account and assembles the populated
 * `scrape.accounts` context. Extracted from `ScrapeExecutor.ts` during
 * the Phase 12e file-size drain; this module owns the public entry
 * point re-exported by the `ScrapeExecutor.ts` barrel facade.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { some } from '../../../Types/Option.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IScrapeConfig } from '../../../Types/ScrapeConfig.js';
import type { IFetchStrategy } from '../../Fetch/FetchStrategy.js';
import fetchSequential from './Account.js';
import { buildFetchOpts, computeStartDate, fetchAccountList } from './Fetch.js';
import type { IScrapeOps } from './Types.js';

/** Inputs to {@link buildScrapeOps} (narrowed strategy + context + config). */
interface IScrapeOpsInput<TA, TT> {
  readonly strategy: IFetchStrategy;
  readonly ctx: IPipelineContext;
  readonly config: IScrapeConfig<TA, TT>;
}

/**
 * Build the bundled scrape operations from a narrowed strategy + config.
 * @param input - Narrowed fetch strategy, pipeline context, and scrape config.
 * @returns Bundled IScrapeOps.
 */
function buildScrapeOps<TA, TT>(input: IScrapeOpsInput<TA, TT>): IScrapeOps<TA, TT> {
  const { strategy, ctx, config } = input;
  return {
    strategy,
    config,
    opts: buildFetchOpts(config, ctx),
    startDate: computeStartDate(ctx, config.dateFormat),
  };
}

/**
 * Fetch accounts + transactions and merge them into the context.
 * @param ctx - Pipeline context to populate.
 * @param ops - Bundled scrape operations.
 * @returns Updated context with scrape.accounts populated, or failure.
 */
async function runScrape<TA, TT>(
  ctx: IPipelineContext,
  ops: IScrapeOps<TA, TT>,
): Promise<Procedure<IPipelineContext>> {
  const accountsResult = await fetchAccountList(ops);
  if (!isOk(accountsResult)) return accountsResult;
  const txnResult = await fetchSequential(ops, accountsResult.value);
  if (!isOk(txnResult)) return txnResult;
  return succeed({ ...ctx, scrape: some({ accounts: txnResult.value }) });
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
  if (!ctx.fetchStrategy.has) return fail(ScraperErrorTypes.Generic, 'No fetchStrategy in context');
  const ops = buildScrapeOps({ strategy: ctx.fetchStrategy.value, ctx, config });
  return runScrape(ctx, ops);
}

export default executeScrape;
export { executeScrape };
