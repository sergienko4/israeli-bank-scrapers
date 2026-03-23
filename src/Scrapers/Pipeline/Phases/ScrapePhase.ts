/**
 * Scrape phase — fetches accounts + transactions.
 * Supports three modes:
 *   1. GenericAutoScrape — no bank code: uses ctx.api + WellKnown field mapping
 *   2. IScrapeConfig — bank provides URLs + mappers, executor does fetch
 *   3. CustomScrapeFn — bank provides full function
 */

import type { ITransactionsAccount } from '../../../Transactions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { extractAccountIds, extractTransactions } from '../Mediator/GenericScrapeStrategy.js';
import { some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IApiFetchContext, IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, isOk, succeed } from '../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfig } from '../Types/ScrapeConfig.js';
import { executeScrape } from './ScrapeExecutor.js';

// ── Generic Auto-Scrape (ZERO bank code) ─────────────────

/**
 * Fetch accounts from discovered endpoint, extract IDs via WellKnown.
 * @param api - Auto-injected API fetch context.
 * @returns Array of account IDs.
 */
async function genericFetchAccounts(api: IApiFetchContext): Promise<Procedure<readonly string[]>> {
  if (!api.accountsUrl) return fail(ScraperErrorTypes.Generic, 'No accounts URL discovered');
  const raw = await api.fetchGet<Record<string, unknown>>(api.accountsUrl);
  if (!isOk(raw)) return raw;
  const ids = extractAccountIds(raw.value);
  return succeed(ids);
}

/**
 * Fetch transactions for one account via WellKnown auto-mapping.
 * @param api - API fetch context.
 * @param accountId - Account identifier.
 * @returns Mapped account with transactions.
 */
async function genericFetchTxns(
  api: IApiFetchContext,
  accountId: string,
): Promise<Procedure<ITransactionsAccount>> {
  if (!api.transactionsUrl) return fail(ScraperErrorTypes.Generic, 'No txn URL');
  const raw = await api.fetchGet<Record<string, unknown>>(api.transactionsUrl);
  if (!isOk(raw)) return raw;
  const txns = extractTransactions(raw.value);
  const account: ITransactionsAccount = { accountNumber: accountId, balance: 0, txns: [...txns] };
  return succeed(account);
}

/**
 * Generic auto-scrape — uses ctx.api + WellKnown field mapping.
 * Banks provide ZERO code. The mediator discovers everything.
 * @param ctx - Pipeline context with ctx.api injected by DASHBOARD.
 * @returns Updated context with scraped accounts.
 */
async function genericAutoScrape(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!ctx.api.has) return succeed(ctx);
  const api = ctx.api.value;
  const accountsResult = await genericFetchAccounts(api);
  if (!isOk(accountsResult)) return accountsResult;
  const fetches = accountsResult.value.map(
    (id): Promise<Procedure<ITransactionsAccount>> => genericFetchTxns(api, id),
  );
  const results = await Promise.all(fetches);
  const accounts = results.filter(isOk).map((r): ITransactionsAccount => r.value);
  return succeed({ ...ctx, scrape: some({ accounts }) });
}

// ── Step factories ───────────────────────────────────────

/**
 * Create a scrape step from an IScrapeConfig (generic mode).
 * @param config - The bank's scrape configuration.
 * @returns A pipeline step that fetches and maps transactions.
 */
function createConfigScrapeStep<TA, TT>(
  config: IScrapeConfig<TA, TT>,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  const step: IPipelineStep<IPipelineContext, IPipelineContext> = {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => executeScrape(input, config),
  };
  return step;
}

/**
 * Create a scrape step from a custom function (edge case mode).
 * @param scrapeFn - The bank's custom scrape function.
 * @returns A pipeline step for scraping.
 */
function createCustomScrapeStep(
  scrapeFn: CustomScrapeFn,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  const step: IPipelineStep<IPipelineContext, IPipelineContext> = {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => scrapeFn(input),
  };
  return step;
}

/**
 * Default scrape — auto-discovers accounts + transactions via ctx.api + WellKnown.
 * Banks with ZERO custom scraper use this automatically.
 * @param _ctx - Unused.
 * @param input - Pipeline context with ctx.api.
 * @returns Updated context with scraped accounts.
 */
function autoScrapeExecute(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  return genericAutoScrape(input);
}

/** Default auto-scrape step — uses WellKnown when no custom scraper provided. */
const SCRAPE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape',
  execute: autoScrapeExecute,
};

export type { CustomScrapeFn } from '../Types/ScrapeConfig.js';
export default SCRAPE_STEP;
export { createConfigScrapeStep, createCustomScrapeStep, genericAutoScrape, SCRAPE_STEP };
