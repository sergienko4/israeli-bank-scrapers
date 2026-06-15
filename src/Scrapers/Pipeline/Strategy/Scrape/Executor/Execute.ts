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
import fetchSequential from './Account.js';
import { buildFetchOpts, computeStartDate, fetchAccountList } from './Fetch.js';
import type { IScrapeOps } from './Types.js';

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
